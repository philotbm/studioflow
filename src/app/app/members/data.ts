export type HistoryEvent = {
  date: string;
  event: string;
  type: "attended" | "late_cancel" | "no_show" | "purchase" | "started" | "upcoming";
};

export type ClassMixEntry = {
  label: string;
  count: number;
};

export type MemberInsights = {
  totalAttended: number;
  lateCancels: number;
  noShows: number;
  cancellationRate: string;
  avgHoldBeforeCancel: string;
  preCutoffCancels: number;
  postCutoffCancels: number;
  behaviourScore: number;
  behaviourLabel: "Strong" | "Mixed" | "Needs attention";
  classMix: ClassMixEntry[];
};

export type CreditUsageEntry = {
  className: string;
  date: string;
};

export type PurchaseStatus = "Active" | "Previous" | "Consumed" | "Expired";

export type CreditPackPurchase = {
  type: "credit_pack";
  product: string;
  purchaseDate: string;
  totalCredits: number;
  creditsUsed: number;
  creditsRemaining: number;
  lastUsedDate: string | null;
  purchaseStatus: PurchaseStatus;
  usageLog: CreditUsageEntry[];
};

export type UnlimitedPurchase = {
  type: "unlimited";
  product: string;
  startDate: string;
  classesAttendedSinceStart: number;
  purchaseStatus: PurchaseStatus;
};

export type SimplePurchase = {
  type: "simple";
  product: string;
  purchaseDate: string;
  purchaseStatus: PurchaseStatus;
};

export type PurchaseEntry = CreditPackPurchase | UnlimitedPurchase | SimplePurchase;

export type PurchaseInsights = {
  activePlan: PurchaseEntry;
  previousPurchases: PurchaseEntry[];
  buyerPattern: string;
};

export type OpportunitySignal = {
  label: string;
  detail: string;
  tone: "positive" | "neutral" | "attention";
};

/**
 * Top-level entitlement category driving booking access.
 * Mirrors the `plan_type` column on the `members` table.
 */
export type PlanType = "unlimited" | "class_pack" | "trial" | "drop_in";

/**
 * Stable, machine-readable booking access code from the DB truth source.
 * Exhaustive — any new case must be added to `sf_check_eligibility` in
 * supabase/functions.sql first, then surfaced here.
 *
 * v0.9.4.1 Booking Truth Simplification: "account_inactive" removed.
 * Account lifecycle is not a StudioFlow product concept at this phase
 * and no longer appears in this union. sf_check_eligibility never emits
 * it.
 */
export type BookingAccessStatus =
  | "ok"
  | "no_credits"
  | "trial_used"
  | "no_entitlement"
  | "not_found";

/**
 * Server-derived booking access state. The DB is the only place these
 * rules live (see `sf_check_eligibility` and `v_members_with_access`);
 * this type is only a transport shape for the client.
 */
export type BookingAccess = {
  canBook: boolean;
  reason: string;
  entitlementLabel: string;
  creditsRemaining: number | null;
  actionHint: string;
  statusCode: BookingAccessStatus;
};

export type Member = {
  id: string;
  name: string;
  plan: string;
  planType: PlanType;
  credits: number | null;
  /** Server-truth booking access — derived by sf_check_eligibility, transported via v_members_with_access. */
  bookingAccess: BookingAccess;
  insights: MemberInsights;
  purchaseInsights: PurchaseInsights;
  opportunitySignals: OpportunitySignal[];
  history: HistoryEvent[];
};

// Seed data removed in v0.4.8 — Supabase is now the source of truth.
export const seedMemberSlugs = [
  "emma-kelly", "ciara-byrne", "declan-power", "saoirse-flynn",
  "sean-brennan", "clodagh-murray", "conor-brady", "aoife-nolan",
  "padraig-roche", "fiona-healy",
];
