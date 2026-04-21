import type {
  Member,
  BookingAccessStatus,
  BookingAccess,
  PlanType,
} from "@/app/app/members/data";

/**
 * v0.9.0 Eligibility + Credit Consumption Foundation — canonical TS
 * rule module.
 *
 * The authoritative rules live in `sf_check_eligibility` + the
 * `v_members_with_access` view (supabase/functions.sql). That SQL is
 * what gates every real booking and runs inside `sf_book_member`'s
 * transaction. This module is deliberately NOT a second source of
 * truth; it is a typed mirror that:
 *
 *   1. Documents the four-way entitlement model in code so reviewers
 *      can read the rules without switching to SQL.
 *   2. Adds the one piece the server response doesn't carry directly —
 *      how many credits the booking will consume — so every UI surface
 *      (AddMemberControl, member detail, future booking confirmations)
 *      can speak one vocabulary.
 *   3. Re-exports the reason message + entitlement label straight from
 *      the server `BookingAccess` payload without re-deriving them,
 *      so the operator-facing copy never drifts from the SQL source.
 *
 * Locked product rules for v0.9.0:
 *
 *   - One booking consumes one credit.
 *   - Credits are consumed on booking, not on attendance.
 *   - Credits are restored on valid cancellation, NOT on late cancel.
 *   - Unlimited memberships consume nothing.
 *   - Blocked bookings always carry a clear reason.
 *
 * The four entitlement sources this release supports:
 *
 *   unlimited — unlimited plan, 0 credits consumed per booking
 *   credits   — class_pack or trial plan, 1 credit consumed per booking
 *               (only when credits remaining > 0)
 *   drop_in   — walk-in / ad-hoc, 0 credits consumed (tracked as the
 *               entitlement source so reconciliation can tell them
 *               apart from unlimited)
 *   none      — no valid entitlement; booking is blocked.
 */

/** Operator-facing entitlement taxonomy — coarser than plan_type. */
export type EntitlementSource = "unlimited" | "credits" | "drop_in" | "none";

/** How many credits this booking will consume. Fixed at 0 or 1 for v0.9.0. */
export type Consumption = 0 | 1;

/**
 * Single deterministic eligibility decision. Composed from the server's
 * BookingAccess payload (authoritative truth) plus the plan-type → source
 * + consumption mapping this module owns.
 */
export type EligibilityDecision = {
  /** Whether the booking may proceed. Mirrors server `canBook`. */
  allowed: boolean;
  /** Structured server status code — primary machine-readable discriminator. */
  statusCode: BookingAccessStatus;
  /** Coarser entitlement category the UI can switch on. */
  source: EntitlementSource;
  /** How many credits a successful booking will consume right now. */
  consumes: Consumption;
  /** Short one-line reason from the server, safe to show verbatim. */
  reason: string;
  /** Entitlement label from the server ("Unlimited", "Class pack (3 left)", etc.). */
  entitlementLabel: string;
  /** Operator action hint from the server. */
  actionHint: string;
  /** Current credit balance if the member is on a countable plan. */
  creditsRemaining: number | null;
};

/**
 * Map a plan_type onto the coarser entitlement source this release ships.
 * class_pack and trial collapse to "credits" because both consume one
 * credit per booking and both gate on remaining balance. drop_in collapses
 * to "drop_in" (no credit, explicit source). unlimited stays itself.
 */
export function entitlementSourceFor(planType: PlanType): EntitlementSource {
  switch (planType) {
    case "unlimited":
      return "unlimited";
    case "class_pack":
    case "trial":
      return "credits";
    case "drop_in":
      return "drop_in";
  }
}

/**
 * Pure consumption rule: given a would-be booking that the server has
 * already judged allowed, how many credits should it consume?
 *
 * Mirrors the server side exactly:
 *   - unlimited         → 0 (sf_consume_credit is a no-op)
 *   - credits (pack/trial) → 1
 *   - drop_in           → 0 (v0.9.0 doesn't charge drop-ins yet)
 *   - none              → 0 (not allowed — consumption is moot)
 */
export function consumptionFor(
  source: EntitlementSource,
  allowed: boolean,
): Consumption {
  if (!allowed) return 0;
  return source === "credits" ? 1 : 0;
}

/**
 * Canonical decision for a member at the current moment.
 *
 * Uses the server's bookingAccess (authoritative truth) for allowed /
 * reason / entitlementLabel, and this module for source + consumes.
 * Pass the member record read from `v_members_with_access`.
 */
export function decideEligibility(member: Member): EligibilityDecision {
  const access: BookingAccess = member.bookingAccess;
  const source = entitlementSourceFor(member.planType);
  const consumes = consumptionFor(source, access.canBook);
  return {
    allowed: access.canBook,
    statusCode: access.statusCode,
    source,
    consumes,
    reason: access.reason,
    entitlementLabel: access.entitlementLabel,
    actionHint: access.actionHint,
    creditsRemaining: access.creditsRemaining,
  };
}

/**
 * Short operator-facing consumption phrase for a decision.
 * Used on successful-booking feedback and the member-detail panel so
 * the operator can see at a glance what cost the booking carries.
 */
export function consumptionLabel(decision: EligibilityDecision): string {
  if (!decision.allowed) return "No booking possible";
  if (decision.consumes === 0) {
    return decision.source === "unlimited"
      ? "No credit consumed — unlimited membership"
      : "No credit consumed — drop-in booking";
  }
  return "Will consume 1 credit";
}

/** Same label in past tense, for post-booking confirmations. */
export function consumedLabel(decision: EligibilityDecision): string {
  if (!decision.allowed) return "";
  if (decision.consumes === 0) {
    return decision.source === "unlimited"
      ? "No credit used — unlimited"
      : "No credit used — drop-in";
  }
  return "1 credit used";
}

/**
 * Cancellation restoration rule (see sf_cancel_booking for the
 * authoritative server logic). Expressed in TS so the UI can pre-announce
 * the expected restoration before the server round-trip.
 *
 *   - on-time cancel of a credits booking → 1 credit restored
 *   - late cancel (any) → 0 credits restored
 *   - unlimited / drop_in → 0 credits (nothing to restore)
 */
export type CancellationRestoration = {
  restoresCredits: 0 | 1;
  reason: string;
};

export function restorationForCancel(
  source: EntitlementSource,
  late: boolean,
): CancellationRestoration {
  if (late) {
    return {
      restoresCredits: 0,
      reason: "Late cancellation — no credit restored",
    };
  }
  if (source === "credits") {
    return {
      restoresCredits: 1,
      reason: "On-time cancellation — 1 credit restored",
    };
  }
  return {
    restoresCredits: 0,
    reason: "No credit to restore",
  };
}

// v0.9.4.1: `isAccountBlocked` helper removed. Account status is not a
// StudioFlow product concept at this phase. Booking gating is entitlement
// only (unlimited OR credits > 0). The server's `bookingAccess.canBook`
// is the single source of truth the UI must honour.
