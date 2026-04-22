"use client";

import { type Plan, formatPriceEur } from "@/lib/plans";

/**
 * v0.14.0 Plans & credit packs section.
 *
 * Consumes the plans array the parent (MemberHome) pulls from the
 * client store, which in turn hydrates from the `plans` DB table. No
 * hardcoded catalogue. The parent handles the Buy click by calling
 * /api/stripe/create-checkout-session; that route resolves the plan
 * from the DB, not from an in-memory constant.
 *
 * Presentation-only. The old free-text `headline` / `description`
 * fields from the pre-v0.14 constant array don't exist on the DB row,
 * so we render a short derived tagline from type + credits + price
 * instead. Keeps the card compact and factual.
 */

export function PlansSection({
  plans,
  onBuy,
  highlighted,
  busyPlanId,
}: {
  plans: Plan[];
  onBuy: (plan: Plan) => void;
  /**
   * Optional plan id to visually emphasise — used by MemberHome to
   * draw attention to a specific card after a failed booking. Cosmetic.
   */
  highlighted?: string;
  /** Plan id currently processing a Buy click — disables that card. */
  busyPlanId?: string | null;
}) {
  if (plans.length === 0) {
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
          No plans are available yet. Ask the studio to add a plan.
        </p>
      </section>
    );
  }
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
        {plans.map((plan) => {
          const emphasized = highlighted === plan.id;
          const isBusy = busyPlanId === plan.id;
          const accessLabel =
            plan.type === "unlimited" ? "Unlimited" : "Credit pack";
          const headline =
            plan.type === "unlimited"
              ? "Unlimited classes"
              : plan.credits === 1
                ? "1 class"
                : `${plan.credits} classes`;
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
                {accessLabel}
              </span>
              <span className="text-sm font-medium">{plan.name}</span>
              <span className="text-xs text-white/50">{headline}</span>
              <span className="text-xs text-white/60">
                {formatPriceEur(plan.priceCents)}
              </span>
              <button
                onClick={() => onBuy(plan)}
                disabled={isBusy || (busyPlanId !== null && busyPlanId !== undefined)}
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
