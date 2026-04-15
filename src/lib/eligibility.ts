// StudioFlow v0.6.0 — Economic Engine Foundation
//
// Shared truth-source for booking eligibility. This is the single function
// that decides whether a member is economically allowed to book a class.
// Everything downstream (UI blocking, future server-side RPC validation,
// dashboards) should consume the structured result from here instead of
// re-deriving rules locally.
//
// Keep this file pure, synchronous, and free of React / Supabase imports so
// it can be called from both client and server code (and future tests).

import type { Member, PlanType } from "@/app/app/members/data";

/** Minimal shape the engine needs — any `Member` satisfies this. */
export type EligibilityInput = {
  planType: PlanType;
  plan: string;
  credits: number | null;
  status: "active" | "expiring" | "expired";
};

export type EligibilityResult = {
  /** Whether the member can currently book a class. */
  canBook: boolean;
  /**
   * One-line, human-readable explanation. Always populated so UI can show
   * both allow-states ("Unlimited access") and block-states ("No credits
   * remaining"). Safe to display directly to an operator.
   */
  reason: string;
  /** Short label describing the active entitlement, e.g. "Unlimited" or "3 credits left". */
  entitlementLabel: string;
  /** `null` for unlimited or if not credit-based; otherwise the remaining count. */
  creditsRemaining: number | null;
  /**
   * Suggested next step for the operator when blocked, or a neutral nudge
   * when eligible. Intentionally short; always populated.
   */
  actionHint: string;
};

function planTypeLabel(planType: PlanType): string {
  switch (planType) {
    case "unlimited":
      return "Unlimited";
    case "class_pack":
      return "Class pack";
    case "trial":
      return "Trial";
    case "drop_in":
      return "Drop-in";
  }
}

/**
 * Decide whether the given member can book a class right now.
 *
 * Rules (v0.6.0 foundation):
 *  1. `status === "expired"` → blocked regardless of plan.
 *  2. `planType === "unlimited"` → allowed.
 *  3. `planType === "class_pack"` → allowed iff `credits > 0`.
 *  4. `planType === "trial"` → allowed iff `credits > 0`.
 *  5. `planType === "drop_in"` → blocked (no ongoing entitlement).
 *
 * This function is the single place these rules live. Callers must not
 * re-implement parts of it — extend this file instead.
 */
export function checkBookingEligibility(
  member: EligibilityInput,
): EligibilityResult {
  // 1. Hard expiry short-circuits everything else.
  if (member.status === "expired") {
    return {
      canBook: false,
      reason: "Membership expired",
      entitlementLabel: "Expired",
      creditsRemaining: member.credits,
      actionHint: "Renew plan or purchase a new pack to book",
    };
  }

  // 2. Unlimited — always eligible while active/expiring.
  if (member.planType === "unlimited") {
    return {
      canBook: true,
      reason: "Unlimited access",
      entitlementLabel: "Unlimited",
      creditsRemaining: null,
      actionHint: "Member can book any class",
    };
  }

  // 3. Class pack — credits must be positive.
  if (member.planType === "class_pack") {
    const credits = member.credits ?? 0;
    if (credits <= 0) {
      return {
        canBook: false,
        reason: "No credits remaining",
        entitlementLabel: `${member.plan} (0 left)`,
        creditsRemaining: 0,
        actionHint: "Sell a new class pack to continue booking",
      };
    }
    return {
      canBook: true,
      reason:
        credits === 1
          ? "1 credit remaining — last class on this pack"
          : `${credits} credits remaining`,
      entitlementLabel: `${planTypeLabel(member.planType)} (${credits} left)`,
      creditsRemaining: credits,
      actionHint:
        credits === 1
          ? "Offer a renewal after this booking"
          : "Member can book a class",
    };
  }

  // 4. Trial — one or more trial credits.
  if (member.planType === "trial") {
    const credits = member.credits ?? 0;
    if (credits <= 0) {
      return {
        canBook: false,
        reason: "Trial used up",
        entitlementLabel: "Trial (0 left)",
        creditsRemaining: 0,
        actionHint: "Convert trial to a full plan to book again",
      };
    }
    return {
      canBook: true,
      reason: "Trial entitlement active",
      entitlementLabel: `Trial (${credits} left)`,
      creditsRemaining: credits,
      actionHint: "Follow up after class to convert",
    };
  }

  // 5. Drop-in / unknown — no ongoing entitlement.
  return {
    canBook: false,
    reason: "No active entitlement",
    entitlementLabel: planTypeLabel(member.planType),
    creditsRemaining: member.credits,
    actionHint: "Member needs a plan or credit pack before booking",
  };
}

/**
 * Convenience wrapper for places that already hold a full `Member`.
 * Kept as a separate name so call-sites read clearly.
 */
export function eligibilityFor(member: Member): EligibilityResult {
  return checkBookingEligibility(member);
}
