import type {
  Member,
  PlanType,
  PurchaseEntry,
  CreditPackPurchase,
  UnlimitedPurchase,
} from "@/app/app/members/data";
import type { EntitlementSource } from "@/lib/eligibility";
import { entitlementSourceFor } from "@/lib/eligibility";
import { PLAN_OPTIONS } from "@/lib/plans";

/**
 * v0.9.4 Memberships / Packs Foundation — presentation-only.
 *
 * This module is a THIN, TS-only derivation layer for operator-facing
 * commercial context. It does NOT make any bookability judgement and
 * does NOT compete with `sf_check_eligibility` / `v_members_with_access`.
 * The server remains the sole source of booking-access truth — read
 * `member.bookingAccess.canBook` for that.
 *
 * What this module owns:
 *   - one consolidated "commercial status" snapshot per member
 *     (plan shape, pack size, credits, health bucket, tone, summary line)
 *   - so the member list, member detail, and class-detail AddMember
 *     control all share one vocabulary instead of reassembling it
 *     from three separate fields
 *
 * What this module does NOT own:
 *   - account lifecycle (active/paused/inactive) — not read here at all
 *   - any `canBook` or bookability verdict — deliberately absent from
 *     MembershipSummary to prevent client-side rule drift
 */

/**
 * Coarse commercial-status bucket. Exhaustive — every member projects
 * onto exactly one value. Buckets distinguish the "shape" of access
 * (unlimited vs counted vs drop-in) AND its health (healthy / low /
 * drained). Account-lifecycle buckets were explicitly removed in v0.9.4
 * to keep this release strictly entitlement-focused.
 */
export type MembershipStatus =
  | "unlimited_active"   // Unlimited plan — always bookable
  | "pack_healthy"       // Pack / trial with >= 3 credits left (or healthy ratio)
  | "pack_low"           // Pack / trial with 1–2 credits left — nudge to renew
  | "pack_drained"       // Pack / trial with 0 credits — not bookable until renewal
  | "drop_in_only";      // Drop-in / walk-in — no persistent access

/** Tone used by the UI to colour the pill / row. */
export type MembershipTone = "positive" | "neutral" | "attention" | "blocked";

/**
 * Consolidated commercial view of a member. All fields are derived
 * strictly from the Member record — nothing here contradicts the server.
 * Consumers should use `summaryLine` as the primary operator-facing
 * string and `status` as the machine-readable discriminator.
 */
export type MembershipSummary = {
  /** Plan display name, straight from `members.plan_name`. */
  planName: string;
  /** Raw plan_type from the DB, pass-through. */
  planType: PlanType;
  /** Coarse source of access this member uses. */
  accessType: EntitlementSource;
  /** One of five commercial-status buckets; see MembershipStatus docs. */
  status: MembershipStatus;
  /** Live credit balance — null for unlimited and drop-in. */
  creditsRemaining: number | null;
  /** Seed-time pack size, when the active plan is a credit pack. */
  totalCredits: number | null;
  /** Unlimited start date OR pack purchase date, when available. */
  startDate: string | null;
  /** Short operator-facing sentence that sums up the commercial state. */
  summaryLine: string;
  /** Optional single-line renewal nudge (e.g. "Running low on credits"). */
  restrictionNote: string | null;
  /** UI tone for colouring the row / pill. */
  tone: MembershipTone;
};

// ── Pack health threshold ───────────────────────────────────────────
/**
 * A pack / trial with ≤ 2 credits left is considered "low". This is the
 * renewal-nudge boundary — the same boundary the member-list already
 * uses to colour the credits string amber at 1 credit. v0.9.4 promotes
 * that single-cell heuristic to a system-wide bucket.
 */
const PACK_LOW_THRESHOLD = 2;

// ── Active plan extraction ───────────────────────────────────────────
/**
 * Pull the active plan entry out of `purchase_insights_json.activePlan`,
 * narrowing to a typed purchase entry when one is present. Returns null
 * for QA fixtures or any member whose purchase_insights_json has no
 * activePlan — the summary still renders from the DB columns in that
 * case, just without a start date.
 */
function extractActivePlan(member: Member): PurchaseEntry | null {
  const pi = member.purchaseInsights;
  if (!pi) return null;
  const active = (pi as { activePlan?: PurchaseEntry }).activePlan;
  return active ?? null;
}

function activeUnlimited(member: Member): UnlimitedPurchase | null {
  const active = extractActivePlan(member);
  if (active?.type === "unlimited") return active;
  return null;
}

function activeCreditPack(member: Member): CreditPackPurchase | null {
  const active = extractActivePlan(member);
  if (active?.type === "credit_pack") return active;
  return null;
}

/**
 * v0.13.3 safe pack-size derivation.
 *
 * The prior rule used the seed-time `purchase_insights_json.activePlan
 * .totalCredits` verbatim, which drifted out of sync the moment a
 * member bought a bigger pack — e.g. a seeded 5-Class Pass member who
 * bought a 10-Class Pass ended up showing "10 of 5 credits left".
 *
 * The new rule matches the CURRENT `plan_name` against the central
 * plan catalogue (src/lib/plans.ts) and returns the matched pack size
 * ONLY when the live credit balance fits inside it. If balance exceeds
 * the pack (e.g. manual operator adjustments, unusual top-ups), we
 * return `null` so the UI falls back to the neutral "X credits left"
 * copy rather than mathematically impossible "X of Y" wording.
 */
function derivePackSize(member: Member): number | null {
  if (member.planType !== "class_pack" && member.planType !== "trial") {
    return null;
  }
  const credits = member.credits;
  if (credits === null) return null;
  const plan = PLAN_OPTIONS.find((p) => p.name === member.plan);
  if (plan?.credits === undefined) return null;
  if (credits > plan.credits) return null;
  return plan.credits;
}

// ── Bucket derivation ────────────────────────────────────────────────
/**
 * Map a member onto exactly one MembershipStatus bucket. Projection is
 * on plan_type and credit balance ONLY — account lifecycle is not read.
 *
 *   unlimited    → unlimited_active
 *   drop_in      → drop_in_only
 *   class_pack,
 *   trial        → credits-based: pack_drained (0) / pack_low (1–2) / pack_healthy
 */
function deriveStatus(member: Member): MembershipStatus {
  switch (member.planType) {
    case "unlimited":
      return "unlimited_active";
    case "drop_in":
      return "drop_in_only";
    case "class_pack":
    case "trial": {
      const credits = member.credits ?? 0;
      if (credits <= 0) return "pack_drained";
      if (credits <= PACK_LOW_THRESHOLD) return "pack_low";
      return "pack_healthy";
    }
  }
}

// ── Summary line composition ─────────────────────────────────────────
/**
 * One-line operator-facing sentence. Deliberately concrete: it names the
 * plan, the access shape, and — for pack-based plans — the current
 * balance in "X of Y" form. This is the string the member-list cell and
 * the member-detail Membership panel both read; keeping composition in
 * one place means the two surfaces can't drift.
 */
function composeSummary(
  member: Member,
  status: MembershipStatus,
  packSize: number | null,
): string {
  const plan = member.plan;
  switch (status) {
    case "unlimited_active":
      return `${plan} · Unlimited access`;
    case "pack_healthy": {
      const c = member.credits ?? 0;
      // v0.13.3: only include "of Y" when packSize is present AND the
      // balance fits inside it. derivePackSize already enforces that —
      // here we just trust the guard above.
      if (packSize !== null) {
        return `${plan} · ${c} of ${packSize} credits left`;
      }
      return `${plan} · ${c} credits left`;
    }
    case "pack_low": {
      const c = member.credits ?? 0;
      const credLabel = c === 1 ? "1 credit left" : `${c} credits left`;
      if (packSize !== null) {
        return `${plan} · ${credLabel} (low — renewal nudge)`;
      }
      return `${plan} · ${credLabel} (low)`;
    }
    case "pack_drained":
      return `${plan} · Drained — needs renewal`;
    case "drop_in_only":
      return `${plan} · Drop-in / walk-in only`;
  }
}

function composeRestriction(status: MembershipStatus): string | null {
  switch (status) {
    case "pack_drained":
      return "Pack has no credits remaining — sell a new pack or adjust credit to unblock booking.";
    case "pack_low":
      return "Running low on credits — good moment to offer a renewal.";
    default:
      return null;
  }
}

function toneFor(status: MembershipStatus): MembershipTone {
  switch (status) {
    case "unlimited_active":
    case "pack_healthy":
      return "positive";
    case "drop_in_only":
      return "neutral";
    case "pack_low":
      return "attention";
    case "pack_drained":
      return "blocked";
  }
}

/**
 * Main entry point. Fold a Member into a MembershipSummary.
 *
 * The returned object is read-only; all fields are scalars or copies of
 * the Member's own values. Callers MUST use `member.bookingAccess`
 * (the server's truth, served via v_members_with_access) for any
 * booking-gating decision. MembershipSummary is a presentation
 * projection only — it deliberately carries no bookability field so it
 * cannot be confused with or override the server's can_book verdict.
 */
export function summariseMembership(member: Member): MembershipSummary {
  const status = deriveStatus(member);
  const unlimited = activeUnlimited(member);
  const pack = activeCreditPack(member);
  const startDate = unlimited?.startDate ?? pack?.purchaseDate ?? null;
  // v0.13.3: derive pack size from the plan catalogue + live balance
  // guard (see derivePackSize). This is the ONLY source the public
  // `totalCredits` field and composeSummary's "X of Y" phrase read
  // from — seed `pack.totalCredits` is no longer trusted because it
  // drifts after a purchase.
  const packSize = derivePackSize(member);

  return {
    planName: member.plan,
    planType: member.planType,
    accessType: entitlementSourceFor(member.planType),
    status,
    creditsRemaining: member.credits,
    totalCredits: packSize,
    startDate,
    summaryLine: composeSummary(member, status, packSize),
    restrictionNote: composeRestriction(status),
    tone: toneFor(status),
  };
}

/**
 * Compact label used in the member-list row. Kept short so the list
 * stays scannable; the full summaryLine is reserved for the detail page.
 *
 *   unlimited_active  →  "Unlimited"
 *   pack_healthy      →  "3 / 10 credits"
 *   pack_low          →  "1 credit left · low"
 *   pack_drained      →  "No credits"
 *   drop_in_only      →  "Drop-in"
 */
export function shortStatusLabel(summary: MembershipSummary): string {
  switch (summary.status) {
    case "unlimited_active":
      return "Unlimited";
    case "pack_healthy": {
      const c = summary.creditsRemaining ?? 0;
      return summary.totalCredits
        ? `${c} / ${summary.totalCredits} credits`
        : `${c} credits`;
    }
    case "pack_low": {
      const c = summary.creditsRemaining ?? 0;
      const base = c === 1 ? "1 credit left" : `${c} credits left`;
      return `${base} · low`;
    }
    case "pack_drained":
      return "No credits";
    case "drop_in_only":
      return "Drop-in";
  }
}

/**
 * Human-readable access-type label. "Unlimited" / "Credit pack" /
 * "Trial credits" / "Drop-in" — distinguishes counted-credit plans from
 * the one-off trial path, which is clearer than lumping both under
 * "credits".
 */
export function accessTypeLabel(summary: MembershipSummary): string {
  if (summary.accessType === "unlimited") return "Unlimited";
  if (summary.accessType === "drop_in") return "Drop-in";
  return summary.planType === "trial" ? "Trial credits" : "Credit pack";
}
