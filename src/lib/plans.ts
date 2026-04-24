/**
 * v0.14.0 central plan catalogue — shape + lookup helper.
 *
 * The canonical catalogue now lives in the `plans` table in Supabase
 * (see supabase/v0.14.0_migration.sql). This file holds the TS shape
 * and one tiny lookup helper; it no longer carries any hardcoded plan
 * data. Every consumer either:
 *
 *   - fetches plans from the DB server-side via src/lib/plans-db.ts
 *     (applyPurchase, create-checkout-session, /app/plans page,
 *     /api/admin/plans route), or
 *
 *   - reads the hydrated slice from the client store via usePlans()
 *     (plans-section, member-home, member-detail, memberships).
 *
 * Removing the old PLAN_OPTIONS constant is deliberate: per the v0.14.0
 * brief, plan names and credits must originate from real DB rows, not
 * an in-code array that silently drifts from what the admin created.
 */

export type PlanType = "class_pack" | "unlimited";

/** One row from the `plans` table, projected onto camelCase. */
export type Plan = {
  id: string;
  name: string;
  type: PlanType;
  priceCents: number;
  /** class_pack: credits > 0; unlimited: null (enforced by DB CHECK). */
  credits: number | null;
  /** v0.14.1: false hides the plan from member-facing purchase surfaces. */
  active: boolean;
  createdAt: string;
};

/**
 * v0.14.1 deterministic slug for plan ids. Lowercase, strip non-alnum,
 * collapse runs of underscores. Operator-facing UIs never ask for ids
 * — this is the internal derivation.
 */
export function generatePlanId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "plan";
}

/** Lookup helper: consumers pass their own plans array (DB fetch or store slice). */
export function findPlan(
  id: string,
  plans: ReadonlyArray<Plan>,
): Plan | undefined {
  return plans.find((p) => p.id === id);
}

/** Format a plan row for a Stripe `product_data.description` field. */
export function planDescription(plan: Plan): string {
  if (plan.type === "unlimited") return `${plan.name} · Unlimited access for the billing period`;
  return `${plan.name} · ${plan.credits} credits`;
}

/** `priceCents` → "€49.00" style label for operator UI. */
export function formatPriceEur(priceCents: number): string {
  const euros = priceCents / 100;
  return `€${euros.toFixed(2)}`;
}
