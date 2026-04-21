"use client";

import { PLAN_OPTIONS, type PlanOption } from "@/lib/plans";

/**
 * v0.13.0 Plans & credit packs section.
 *
 * Reads PLAN_OPTIONS from the central catalogue in src/lib/plans.ts.
 * The parent (MemberHome) handles the Buy click by kicking off the
 * real purchase flow in src/app/api/stripe/create-checkout-session —
 * which either redirects to Stripe Checkout (real) or returns a fake
 * mode signal that the parent then follows up with a call to
 * /api/dev/fake-purchase.
 *
 * This component is presentation-only; it does not know whether
 * Stripe is configured.
 */

export type { PlanOption };

export function PlansSection({
  onBuy,
  highlighted,
  busyPlanId,
}: {
  onBuy: (plan: PlanOption) => void;
  /**
   * Optional plan id to visually emphasise — used by MemberHome to
   * draw attention to a specific card after a failed booking, or when
   * surfacing the section from the no-credits banner. Purely cosmetic.
   */
  highlighted?: string;
  /** Plan id currently processing a Buy click — disables that card. */
  busyPlanId?: string | null;
}) {
  return (
    <section
      id="plans"
      className="mt-10 scroll-mt-8"
      aria-label="Plans and credit packs"
    >
      <h2 className="text-sm font-medium text-white/70">
        Plans & credit packs
      </h2>
      <p className="mt-1 text-xs text-white/40">
        Top up your credits or start an unlimited plan.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {PLAN_OPTIONS.map((plan) => {
          const emphasized = highlighted === plan.id;
          const isBusy = busyPlanId === plan.id;
          return (
            <li
              key={plan.id}
              className={`flex flex-col gap-2 rounded border px-4 py-3 ${
                emphasized
                  ? "border-amber-400/40 bg-amber-400/5"
                  : "border-white/15"
              }`}
            >
              <span className="text-xs uppercase tracking-wide text-white/40">
                {plan.type === "unlimited" ? "Unlimited" : "Credit pack"}
              </span>
              <span className="text-sm font-medium">{plan.name}</span>
              <span className="text-xs text-white/50">{plan.headline}</span>
              <p className="mt-1 text-xs text-white/40 flex-1">
                {plan.description}
              </p>
              <button
                onClick={() => onBuy(plan)}
                disabled={isBusy || busyPlanId !== null && busyPlanId !== undefined}
                className="mt-2 rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isBusy ? "Opening checkout…" : `Buy ${plan.name}`}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
