import { getSupabaseClient } from "@/lib/supabase";
import { findPlan, type PlanOption } from "@/lib/plans";

/**
 * v0.13.0 shared fulfillment entry point.
 *
 * Both /api/stripe/webhook (real checkout) and /api/dev/fake-purchase
 * (dev fallback) call this function. Booking rules are NOT touched;
 * this only handles the ONE-WAY mutation from "purchase succeeded →
 * entitlement granted".
 *
 * Idempotency is enforced server-side via the UNIQUE(external_id)
 * constraint on the `purchases` table (see supabase/v0.13.0_migration
 * .sql). A repeat call with the same externalId is a no-op.
 *
 * Concurrency: the members UPDATE runs inside the Postgres function
 * sf_apply_purchase with `credits_remaining = COALESCE(...) + p_credits`,
 * so a booking that decrements credits between check and write cannot
 * overwrite the purchase amount.
 */

export type PurchaseSource = "stripe" | "fake";

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
};

export type ApplyPurchaseErr = {
  ok: false;
  error: string;
  code?:
    | "unknown_plan"
    | "no_supabase"
    | "rpc_error"
    | "unexpected_response";
};

export type ApplyPurchaseResult = ApplyPurchaseOk | ApplyPurchaseErr;

export async function applyPurchase(
  input: ApplyPurchaseInput,
): Promise<ApplyPurchaseResult> {
  const plan: PlanOption | undefined = findPlan(input.planId);
  if (!plan) {
    return {
      ok: false,
      error: `Unknown plan: ${input.planId}`,
      code: "unknown_plan",
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

  const { data, error } = await client.rpc("sf_apply_purchase", {
    p_member_id: input.memberId,
    p_plan_id: plan.id,
    p_plan_type: plan.type,
    p_plan_name: plan.name,
    p_credits: plan.credits ?? 0,
    p_source: input.source,
    p_external_id: input.externalId,
  });

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

  return {
    ok: true,
    alreadyProcessed: r.already_processed ?? false,
    purchaseId: r.purchase_id,
    planTypeApplied: r.plan_type_applied,
    creditsRemaining: r.credits_remaining ?? null,
  };
}
