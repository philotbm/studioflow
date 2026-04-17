// Hand-written Supabase table row types for StudioFlow.
// These match the schema in supabase/schema.sql and supabase/functions.sql
// (the v_members_with_access view + credit_transactions table added in v0.8.0).

export type MemberRow = {
  id: string;
  slug: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "paused" | "inactive";
  plan_type: "unlimited" | "class_pack" | "trial" | "drop_in";
  plan_name: string;
  credits_remaining: number | null;
  notes: string | null;
  insights_json: Record<string, unknown>;
  purchase_insights_json: Record<string, unknown>;
  opportunity_signals_json: unknown[];
  history_summary_json: unknown[];
  created_at: string;
  updated_at: string;
};

/**
 * Raw shape of the `access` JSONB column served by `v_members_with_access`.
 * Field names use the snake_case the DB function returns; the TypeScript
 * mapper (`mapMemberRow`) is responsible for translating into the
 * camelCase `BookingAccess` shape the UI consumes.
 */
export type AccessJson = {
  can_book: boolean;
  reason: string;
  entitlement_label: string;
  credits_remaining: number | null;
  action_hint: string;
  status_code:
    | "ok"
    | "account_inactive"
    | "no_credits"
    | "trial_used"
    | "no_entitlement"
    | "not_found";
};

/** A row from `v_members_with_access` — everything `members` has, plus `access`. */
export type MemberAccessRow = MemberRow & { access: AccessJson };

/** A row from the `credit_transactions` ledger added in v0.8.0. */
export type CreditTransactionRow = {
  id: string;
  member_id: string;
  delta: number;
  balance_after: number;
  reason_code: string;
  source: "system" | "operator";
  note: string | null;
  class_id: string | null;
  booking_id: string | null;
  operator_key: string | null;
  created_at: string;
};

export type ClassRow = {
  id: string;
  slug: string;
  title: string;
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  location_name: string | null;
  cancellation_window_hours: number;
  // v0.8.4: check-in window length in minutes. Check-in opens
  // (starts_at - check_in_window_minutes) and closes at ends_at.
  check_in_window_minutes: number;
  created_at: string;
  updated_at: string;
};

export type BookingRow = {
  id: string;
  class_id: string;
  member_id: string;
  // v0.8.4: 'attended' dropped from the accepted set — all legacy rows
  // were normalised to 'checked_in' in v0.8.3.
  booking_status: "booked" | "waitlisted" | "cancelled" | "late_cancel" | "no_show" | "checked_in";
  waitlist_position: number | null;
  booked_at: string | null;
  cancelled_at: string | null;
  checked_in_at: string | null;
  promotion_source: "manual" | "auto" | null;
  promoted_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BookingEventRow = {
  id: string;
  class_id: string;
  member_id: string | null;
  booking_id: string | null;
  event_type: string;
  event_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Joined booking row (booking + member slug/name for display)
export type BookingWithMember = BookingRow & {
  member_slug: string;
  member_name: string;
};
