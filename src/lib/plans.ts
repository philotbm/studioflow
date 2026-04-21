/**
 * v0.13.0 central plan catalogue.
 *
 * Single source of truth for purchasable plans. Consumed by:
 *   - src/app/my/[memberSlug]/plans-section.tsx (renders cards)
 *   - src/app/api/stripe/create-checkout-session/route.ts (reads price + name)
 *   - src/app/api/stripe/webhook/route.ts (maps session metadata → plan)
 *   - src/app/api/dev/fake-purchase/route.ts (maps planId → plan)
 *   - src/lib/entitlements/applyPurchase.ts (reads credits/type for fulfillment)
 *
 * When real billing launches and plans gain richer attributes (Stripe
 * product + price IDs, duration, renewal cadence), this is where they
 * land. Adding a plan here makes it visible in the UI AND checkout-able
 * AND fulfillable — no other file needs to know the catalogue.
 */

export type PlanType = "credit_pack" | "unlimited";

export type PlanOption = {
  /** Machine-readable id. Passed through Stripe session metadata. */
  id: string;
  /** Member-facing display name. Shown on the card + in Stripe line item. */
  name: string;
  /** Entitlement shape this plan grants. */
  type: PlanType;
  /** For credit_pack plans: the number of credits granted on purchase. */
  credits?: number;
  /**
   * Placeholder price in minor currency units (cents). Used by Stripe
   * checkout for ad-hoc price_data. Real billing will replace this
   * with a `stripePriceId` pointing at a pre-configured Stripe Price.
   */
  price?: number;
  /**
   * Not populated yet — placeholder for the follow-up Stripe release.
   * When present, create-checkout-session should prefer this over
   * ad-hoc `price_data`.
   */
  stripePriceId?: string;
  /** Short tagline shown on the card. */
  headline: string;
  /** Longer description shown on the card below the headline. */
  description: string;
};

export const PLAN_OPTIONS: ReadonlyArray<PlanOption> = [
  {
    id: "pack_5",
    name: "5-Class Pass",
    type: "credit_pack",
    credits: 5,
    price: 5000, // €50 — placeholder, Stripe test mode
    headline: "5 classes",
    description:
      "Good for casual or returning members. Use your 5 credits across any classes.",
  },
  {
    id: "pack_10",
    name: "10-Class Pass",
    type: "credit_pack",
    credits: 10,
    price: 9000, // €90 — placeholder, Stripe test mode
    headline: "10 classes",
    description:
      "Better per-class value for regulars. 10 credits to spend as you like.",
  },
  {
    id: "unlimited_monthly",
    name: "Unlimited Monthly",
    type: "unlimited",
    price: 12000, // €120 — placeholder, Stripe test mode
    headline: "Unlimited for a month",
    description:
      "Book any class, any time. Real recurring subscription lands when Stripe test mode is swapped for live keys.",
  },
];

export function findPlan(id: string): PlanOption | undefined {
  return PLAN_OPTIONS.find((p) => p.id === id);
}
