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
};

export type ApplyPurchaseErr = {
  ok: false;
  error: string;
  code?:
    | "unknown_plan"
    | "inactive_plan"
    | "no_supabase"
    | "rpc_error"
    | "unexpected_response";
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

  // v0.15.0: try the new source vocabulary first. If the DB CHECK
  // constraint hasn't been widened yet (i.e. the v0.15.0 migration
  // hasn't been applied), fall back to the legacy 'fake' source so the
  // purchase still completes correctly. Stripe is always allowed by
  // the old constraint and never needs the fallback.
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
    // CHECK violation on the source column — pre-v0.15.0 DB. Retry
    // with the legacy 'fake' source so a successful payment doesn't
    // get reported as a failed purchase.
    console.warn(
      "[applyPurchase] source CHECK violation, falling back to 'fake':",
      rpcResult.error.message,
    );
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
  const creditsGranted =
    plan.type === "class_pack" ? plan.credits ?? 0 : null;
  let priceCentsPaid: number | null = null;
  if (!r.already_processed && r.purchase_id) {
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
  };
}
