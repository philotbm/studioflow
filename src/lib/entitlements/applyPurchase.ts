import { getSupabaseClient } from "@/lib/supabase";
import { fetchPlanById } from "@/lib/plans-db";

/**
 * v0.14.0 shared fulfillment entry point.
 *
 * Both /api/stripe/webhook (real checkout) and /api/dev/fake-purchase
 * (dev fallback) call this function. Plan metadata is resolved from
 * the DB `plans` table — the in-code catalogue was removed in v0.14.0.
 *
 * Idempotency is enforced server-side via the UNIQUE(external_id)
 * constraint on the `purchases` table. A repeat call with the same
 * externalId is a no-op.
 *
 * Concurrency: the members UPDATE runs inside the Postgres function
 * sf_apply_purchase with `credits_remaining = COALESCE(...) + p_credits`,
 * so a booking that decrements credits between check and write cannot
 * overwrite the purchase amount.
 */

/**
 * v0.15.0 source vocabulary.
 *
 *   stripe          — real Stripe checkout, fulfilled by the webhook.
 *   dev_fake        — member-home self-serve buy when no Stripe key is
 *                     configured (preview deploys, local dev). Same end
 *                     behaviour as a successful Stripe checkout.
 *   operator_manual — operator test-purchase panel on /app/members/[id].
 *                     Distinct so purchase history can call out
 *                     operator-initiated test purchases separately from
 *                     member-initiated dev fakes.
 *
 * Legacy 'fake' (v0.13.0/v0.14.x) is not emitted by any current caller
 * but remains accepted by the DB CHECK so historical rows still
 * validate.
 */
export type PurchaseSource = "stripe" | "dev_fake" | "operator_manual";

export type ApplyPurchaseInput = {
  memberId: string;
  planId: string;
  source: PurchaseSource;
  externalId: string;
};

export type ApplyPurchaseOk = {
  ok: true;
  alreadyProcessed: boolean;
  purchaseId?: string;
  planTypeApplied?: "class_pack" | "unlimited";
  creditsRemaining?: number | null;
  /** v0.15.0: amount paid recorded on the purchases row (NULL on legacy rows). */
  priceCentsPaid?: number | null;
  /** v0.15.0: credits added recorded on the purchases row (NULL for unlimited). */
  creditsGranted?: number | null;
  /**
   * v0.15.1.1: true when the v0.15.0 migration is missing on this
   * environment and the purchase had to be written with the legacy
   * 'fake' source. The purchase IS fulfilled (entitlement granted)
   * but the row will not carry the requested source label or the
   * v0.15.0 lifecycle columns. /api/admin/purchase-health flags
   * these and the operator should apply
   * supabase/v0.15.0_migration.sql to the environment.
   */
  legacyFallbackUsed?: boolean;
};

export type ApplyPurchaseErr = {
  ok: false;
  error: string;
  code?:
    | "unknown_plan"
    | "inactive_plan"
    | "no_supabase"
    | "rpc_error"
    | "unexpected_response"
    /** v0.15.1: source CHECK violation — v0.15.0 migration not applied. */
    | "source_check_violation";
};

export type ApplyPurchaseResult = ApplyPurchaseOk | ApplyPurchaseErr;

export async function applyPurchase(
  input: ApplyPurchaseInput,
): Promise<ApplyPurchaseResult> {
  // v0.14.0: resolve plan metadata from DB. No hardcoded catalogue.
  const plan = await fetchPlanById(input.planId);
  if (!plan) {
    return {
      ok: false,
      error: `Unknown plan: ${input.planId}`,
      code: "unknown_plan",
    };
  }
  // v0.14.1: belt-and-braces. Even if a client bypasses the active-only
  // filter on the purchase surface, we refuse to grant an entitlement
  // for an inactive plan.
  if (!plan.active) {
    return {
      ok: false,
      error: `Plan is inactive: ${input.planId}`,
      code: "inactive_plan",
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error: "Supabase client is not configured",
      code: "no_supabase",
    };
  }

  // v0.15.1.1: call sf_apply_purchase with the canonical source
  // vocabulary first. If the DB CHECK constraint hasn't been widened
  // (i.e. supabase/v0.15.0_migration.sql is not applied on this
  // environment), retry with legacy 'fake' source so the purchase
  // still fulfils — but log a structured warning AND mark the
  // returned result with legacyFallbackUsed:true so the surface and
  // the diagnostics endpoint can flag it. /api/admin/purchase-health
  // separately reports the missing migration so operators can fix
  // root cause.
  //
  // Stripe is always allowed by the old constraint and never needs
  // the fallback.
  //
  // History (v0.15.1, reverted in v0.15.1.1): an earlier hardening
  // step removed this fallback to prefer fail-loudly. Real prod was
  // unmigrated and that turned all new purchases into hard failures.
  // The mitigation is to keep the fallback but make it explicitly
  // diagnostic-visible (this comment + the `legacyFallbackUsed` flag
  // + the purchase-health reporting), per the original brief's
  // "if removal is risky, keep but make it visible" guidance.
  let legacyFallbackUsed = false;
  let rpcResult = await client.rpc("sf_apply_purchase", {
    p_member_id: input.memberId,
    p_plan_id: plan.id,
    p_plan_type: plan.type,
    p_plan_name: plan.name,
    p_credits: plan.credits ?? 0,
    p_source: input.source,
    p_external_id: input.externalId,
  });

  if (
    rpcResult.error &&
    rpcResult.error.code === "23514" &&
    input.source !== "stripe"
  ) {
    console.warn(
      "[applyPurchase] v0.15.0 migration missing on this DB — falling back to legacy 'fake' source. " +
        "Apply supabase/v0.15.0_migration.sql to fix root cause. requestedSource=" +
        input.source +
        " externalId=" +
        input.externalId,
    );
    legacyFallbackUsed = true;
    rpcResult = await client.rpc("sf_apply_purchase", {
      p_member_id: input.memberId,
      p_plan_id: plan.id,
      p_plan_type: plan.type,
      p_plan_name: plan.name,
      p_credits: plan.credits ?? 0,
      p_source: "fake",
      p_external_id: input.externalId,
    });
  }

  const { data, error } = rpcResult;
  if (error) {
    console.error("[applyPurchase] sf_apply_purchase failed:", error.message);
    return { ok: false, error: error.message, code: "rpc_error" };
  }

  const r = (data ?? {}) as {
    ok?: boolean;
    already_processed?: boolean;
    purchase_id?: string;
    plan_type_applied?: "class_pack" | "unlimited";
    credits_remaining?: number | null;
    error?: string;
  };

  if (!r.ok) {
    return {
      ok: false,
      error: r.error ?? "sf_apply_purchase returned ok=false",
      code: "unexpected_response",
    };
  }

  // v0.15.0: enrich the purchases row with the lifecycle fields the
  // function deliberately doesn't know about. Best-effort by design —
  // the credits and entitlement state are already correct from the
  // RPC, so a failure here (e.g. column missing on a pre-migration
  // database, or a RLS denial) must not present a successful purchase
  // as failed. We log and continue.
  //
  // Skipped on the already_processed path: the row already carries the
  // values from the original apply, and overwriting them on every
  // retry would defeat the "frozen at apply time" property.
  //
  // v0.15.1.1: also skipped when the legacy fallback ran. Those
  // environments don't have the lifecycle columns at all, so the
  // UPDATE would 42703 every time. The console warning above already
  // points operators at the migration; a second noisy log per
  // purchase isn't useful.
  const creditsGranted =
    plan.type === "class_pack" ? plan.credits ?? 0 : null;
  let priceCentsPaid: number | null = null;
  if (!r.already_processed && r.purchase_id && !legacyFallbackUsed) {
    const { error: enrichErr } = await client
      .from("purchases")
      .update({
        status: "completed",
        price_cents_paid: plan.priceCents,
        credits_granted: creditsGranted,
      })
      .eq("id", r.purchase_id);
    if (enrichErr) {
      console.error(
        "[applyPurchase] lifecycle enrichment failed:",
        enrichErr.message,
      );
    } else {
      priceCentsPaid = plan.priceCents;
    }
  }

  return {
    ok: true,
    alreadyProcessed: r.already_processed ?? false,
    purchaseId: r.purchase_id,
    planTypeApplied: r.plan_type_applied,
    creditsRemaining: r.credits_remaining ?? null,
    priceCentsPaid,
    creditsGranted: r.already_processed ? null : creditsGranted,
    legacyFallbackUsed,
  };
}
