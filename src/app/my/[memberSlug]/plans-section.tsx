"use client";

/**
 * v0.12.0 Plans & credit packs section.
 *
 * Foundation-only. Buttons do NOT run a real checkout — they hand off
 * to the parent MemberHome which surfaces a placeholder outcome card
 * explaining that in-app purchasing isn't live yet. When real billing
 * ships, the plan catalogue + card layout here lift cleanly into a
 * dedicated /my/{slug}/shop route without further refactoring.
 *
 * The plan catalogue is defined here, not in src/lib, because:
 *   (a) nothing else in the system reads it yet — these are shop-
 *       facing SKUs, not the members.plan_name the server uses.
 *   (b) keeping it local to the surface avoids premature abstraction
 *       before there's a billing system to wire it to.
 */

export type PlanOption = {
  id: "pack-5" | "pack-10" | "unlimited-monthly";
  name: string;
  kind: "pack" | "unlimited";
  headline: string;
  description: string;
};

export const PLAN_OPTIONS: ReadonlyArray<PlanOption> = [
  {
    id: "pack-5",
    name: "5-Class Pass",
    kind: "pack",
    headline: "5 classes",
    description:
      "Good for casual or returning members. Use your 5 credits across any classes.",
  },
  {
    id: "pack-10",
    name: "10-Class Pass",
    kind: "pack",
    headline: "10 classes",
    description:
      "Better per-class value for regulars. 10 credits to spend as you like.",
  },
  {
    id: "unlimited-monthly",
    name: "Unlimited Monthly",
    kind: "unlimited",
    headline: "Unlimited for a month",
    description:
      "Book any class, any time. Auto-renews on this day next month.",
  },
];

export function PlansSection({
  onBuy,
  highlighted,
}: {
  onBuy: (plan: PlanOption) => void;
  /**
   * Optional plan id to visually emphasise — used by MemberHome to
   * draw attention to a specific card after a failed booking, or when
   * surfacing the section from the no-credits banner. Purely cosmetic.
   */
  highlighted?: PlanOption["id"];
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
                {plan.kind === "unlimited" ? "Unlimited" : "Credit pack"}
              </span>
              <span className="text-sm font-medium">{plan.name}</span>
              <span className="text-xs text-white/50">{plan.headline}</span>
              <p className="mt-1 text-xs text-white/40 flex-1">
                {plan.description}
              </p>
              <button
                onClick={() => onBuy(plan)}
                className="mt-2 rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:text-white hover:border-white/40"
              >
                Buy {plan.name}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-white/30">
        In-app purchase isn&apos;t live yet — these buttons open a
        placeholder confirmation. Real checkout arrives in a future
        release.
      </p>
    </section>
  );
}
