import { getSupabaseClient } from "./supabase";
import type {
  MemberAccessRow,
  ClassRow,
  BookingRow,
  BookingEventRow,
  CreditTransactionRow,
  AccessJson,
} from "./database.types";
import type { StudioClass, Attendee, WaitlistEntry, Lifecycle } from "@/app/app/classes/data";
import type {
  Member,
  MemberInsights,
  PurchaseInsights,
  OpportunitySignal,
  HistoryEvent,
  BookingAccess,
} from "@/app/app/members/data";

/** Throws if Supabase client is not initialized */
function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase client not initialized. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel env vars, then redeploy.",
    );
  }
  return client;
}

// ── Lifecycle derivation (no DB column — computed from timestamps) ───
function deriveLifecycle(startsAt: string, endsAt: string): Lifecycle {
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (end < now) return "completed";
  if (start <= now && end >= now) return "live";
  return "upcoming";
}

function deriveCancellationWindowClosed(
  startsAt: string,
  windowHours: number,
): boolean {
  const cutoff = new Date(startsAt).getTime() - windowHours * 3600_000;
  return Date.now() >= cutoff;
}

function formatClassTime(startsAt: string): string {
  const d = new Date(startsAt);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

// ── DB → App type mappers ───────────────────────────────────────────

/**
 * Translate the snake_case `access` JSONB column from
 * `v_members_with_access` into the camelCase `BookingAccess` shape the
 * UI consumes. The DB is the source of truth — this mapper must not
 * synthesize any missing fields or re-derive rules.
 */
function mapAccess(a: AccessJson | null | undefined): BookingAccess {
  if (!a) {
    // Defensive fallback for old rows or misconfigured view — should
    // never happen in production. Treat as blocked so we fail closed.
    return {
      canBook: false,
      reason: "Access data unavailable",
      entitlementLabel: "Unknown",
      creditsRemaining: null,
      actionHint: "Reload the app",
      statusCode: "not_found",
    };
  }
  return {
    canBook: a.can_book,
    reason: a.reason,
    entitlementLabel: a.entitlement_label,
    creditsRemaining: a.credits_remaining,
    actionHint: a.action_hint,
    statusCode: a.status_code,
  };
}

function mapMemberRow(r: MemberAccessRow): Member {
  return {
    id: r.slug,
    name: r.full_name,
    plan: r.plan_name,
    planType: r.plan_type,
    credits: r.plan_type === "unlimited" ? null : (r.credits_remaining ?? 0),
    accountStatus: r.status,
    bookingAccess: mapAccess(r.access),
    insights: (r.insights_json ?? {}) as MemberInsights,
    purchaseInsights: (r.purchase_insights_json ?? {}) as PurchaseInsights,
    opportunitySignals: (r.opportunity_signals_json ?? []) as OpportunitySignal[],
    history: (r.history_summary_json ?? []) as HistoryEvent[],
  };
}

type BookingJoined = BookingRow & { members: { slug: string; full_name: string } | null };

function mapBookingsToAttendees(
  bookings: BookingJoined[],
  promotionMeta: Map<string, number>,
): Attendee[] {
  // v0.8.3: canonical statuses are booked / checked_in / late_cancel /
  // no_show. Legacy 'attended' rows were normalised by the v0.8.3 SQL
  // migration, but we still map any stray 'attended' read from older
  // caches / transitional rows to 'checked_in' so the client never
  // shows two attendance languages at once.
  return bookings
    .filter((b) => b.booking_status !== "waitlisted" && b.is_active)
    .map((b) => {
      const originalPosition = promotionMeta.get(b.id);
      const status: Attendee["status"] =
        b.booking_status === "attended"
          ? "checked_in"
          : (b.booking_status as Attendee["status"]);

      return {
        name: b.members?.full_name ?? "Unknown",
        memberId: b.members?.slug,
        status,
        ...(b.promotion_source
          ? {
              promotedFromPosition: originalPosition,
              promotionType: b.promotion_source as "manual" | "auto",
            }
          : {}),
      };
    });
}

function mapBookingsToWaitlist(bookings: BookingJoined[]): WaitlistEntry[] {
  return bookings
    .filter((b) => b.booking_status === "waitlisted" && b.is_active)
    .sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999))
    .map((b) => ({
      name: b.members?.full_name ?? "Unknown",
      memberId: b.members?.slug,
      position: b.waitlist_position ?? 0,
    }));
}

function mapClassWithBookings(
  cls: ClassRow,
  bookings: BookingJoined[],
  promotionMeta: Map<string, number>,
): StudioClass {
  const lifecycle = deriveLifecycle(cls.starts_at, cls.ends_at);
  const attendees = mapBookingsToAttendees(bookings, promotionMeta);
  const waitlist = mapBookingsToWaitlist(bookings);

  return {
    id: cls.slug,
    name: cls.title,
    time: formatClassTime(cls.starts_at),
    instructor: cls.instructor_name,
    booked: attendees.filter((a) => a.status !== "late_cancel" || lifecycle !== "upcoming").length,
    capacity: cls.capacity,
    waitlistCount: waitlist.length,
    lifecycle,
    cancellationWindowClosed:
      lifecycle === "upcoming"
        ? deriveCancellationWindowClosed(cls.starts_at, cls.cancellation_window_hours)
        : undefined,
    attendees,
    waitlist: waitlist.length > 0 ? waitlist : undefined,
  };
}

// ── Read queries (unchanged) ────────────────────────────────────────

async function buildPromotionMeta(): Promise<Map<string, number>> {
  const { data: events } = await requireClient()
    .from("booking_events")
    .select("booking_id, metadata")
    .in("event_type", ["promoted_manual", "promoted_auto"]);

  const meta = new Map<string, number>();
  if (events) {
    for (const e of events) {
      if (e.booking_id && (e.metadata as Record<string, unknown>)?.original_position) {
        meta.set(
          e.booking_id,
          (e.metadata as Record<string, unknown>).original_position as number,
        );
      }
    }
  }
  return meta;
}

export async function fetchAllClasses(): Promise<StudioClass[]> {
  const [{ data: classes, error: clsErr }, { data: bookings, error: bkErr }, promotionMeta] =
    await Promise.all([
      requireClient().from("classes").select("*").order("starts_at", { ascending: true }),
      requireClient().from("class_bookings").select("*, members(slug, full_name)").eq("is_active", true),
      buildPromotionMeta(),
    ]);

  if (clsErr) {
    console.error("[fetchAllClasses] classes query failed:", clsErr.message);
    throw new Error(`Failed to fetch classes: ${clsErr.message}`);
  }
  if (!classes) {
    throw new Error("fetchAllClasses: no classes data returned");
  }

  if (bkErr) {
    console.error("[fetchAllClasses] bookings query failed:", bkErr.message);
  }

  const allBookings = (bookings ?? []) as BookingJoined[];
  const bookingsByClass = new Map<string, BookingJoined[]>();
  for (const b of allBookings) {
    const arr = bookingsByClass.get(b.class_id) ?? [];
    arr.push(b);
    bookingsByClass.set(b.class_id, arr);
  }

  return classes.map((c) =>
    mapClassWithBookings(c as ClassRow, bookingsByClass.get(c.id) ?? [], promotionMeta),
  );
}

export async function fetchClassBySlug(slug: string): Promise<StudioClass | null> {
  const { data: cls, error: clsErr } = await requireClient()
    .from("classes")
    .select("*")
    .eq("slug", slug)
    .single();

  if (clsErr || !cls) return null;

  const [{ data: bookings }, promotionMeta] = await Promise.all([
    requireClient()
      .from("class_bookings")
      .select("*, members(slug, full_name)")
      .eq("class_id", cls.id)
      .eq("is_active", true),
    buildPromotionMeta(),
  ]);

  return mapClassWithBookings(cls as ClassRow, (bookings ?? []) as BookingJoined[], promotionMeta);
}

export async function fetchAllMembers(): Promise<Member[]> {
  // v0.8.0: read from the server-derived access view instead of `members`
  // directly. The `access` column is the DB's booking-access truth — the
  // client no longer re-runs any eligibility rules.
  const { data, error } = await requireClient()
    .from("v_members_with_access")
    .select("*")
    .not("plan_type", "eq", "drop_in")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[fetchAllMembers] query failed:", error.message);
    throw new Error(`Failed to fetch members: ${error.message}`);
  }
  if (!data) {
    throw new Error("fetchAllMembers: no data returned");
  }
  return (data as MemberAccessRow[]).map(mapMemberRow);
}

export async function fetchMemberBySlug(slug: string): Promise<Member | null> {
  const { data, error } = await requireClient()
    .from("v_members_with_access")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return mapMemberRow(data as MemberAccessRow);
}

export type AuditEvent = {
  id: string;
  eventType: string;
  eventLabel: string | null;
  memberName: string | null;
  memberSlug: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function fetchBookingEventsForClass(classSlug: string): Promise<AuditEvent[]> {
  const { data: cls } = await requireClient()
    .from("classes")
    .select("id")
    .eq("slug", classSlug)
    .single();

  if (!cls) return [];

  const { data: events } = await requireClient()
    .from("booking_events")
    .select("*, members(slug, full_name)")
    .eq("class_id", cls.id)
    .order("created_at", { ascending: false });

  if (!events) return [];

  return events.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    eventType: e.event_type as string,
    eventLabel: e.event_label as string | null,
    memberName: (e.members as Record<string, unknown> | null)?.full_name as string | null,
    memberSlug: (e.members as Record<string, unknown> | null)?.slug as string | null,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    createdAt: e.created_at as string,
  }));
}

// ── Write mutations (via Postgres RPC — transactional) ──────────────

/** Helper: call an RPC function and throw on error */
async function callRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(name, params);
  if (error) {
    console.error(`[${name}] RPC failed:`, error.message);
    throw new Error(`${name} failed: ${error.message}`);
  }
  const result = data as T & { error?: string };
  if (result && typeof result === "object" && "error" in result && result.error) {
    throw new Error(result.error as string);
  }
  return result;
}

/**
 * Raw shape of what the sf_book_member RPC returns when the server
 * rejects the booking on economic grounds. Populated from the server's
 * structured access payload (including the v0.8.0 status_code field) —
 * the client never derives any of these locally.
 */
export type BlockedBookingResponse = {
  status: "blocked";
  reason: string;
  entitlementLabel: string;
  creditsRemaining: number | null;
  actionHint: string;
  statusCode: import("@/app/app/members/data").BookingAccessStatus;
};

export type BookingOutcome =
  | { status: "booked" | "waitlisted"; alreadyExists?: boolean }
  | BlockedBookingResponse;

export async function bookMemberIntoClass(
  classSlug: string,
  memberSlug: string,
): Promise<BookingOutcome> {
  // The server can legitimately reply with status "blocked" and a
  // structured reason. This is NOT an error — it's a normal domain
  // outcome — so we bypass the callRpc helper (which would throw on
  // error-keyed responses) and inspect the raw response ourselves.
  const { data, error } = await requireClient().rpc("sf_book_member", {
    p_class_slug: classSlug,
    p_member_slug: memberSlug,
  });
  if (error) {
    console.error("[sf_book_member] RPC failed:", error.message);
    throw new Error(`sf_book_member failed: ${error.message}`);
  }
  const result = (data ?? {}) as {
    status?: string;
    booking_id?: string;
    already_exists?: boolean;
    reason?: string;
    entitlement_label?: string;
    credits_remaining?: number | null;
    action_hint?: string;
    status_code?: string;
    error?: string;
  };
  if (result.error) {
    throw new Error(result.error);
  }
  if (result.status === "blocked") {
    return {
      status: "blocked",
      reason: result.reason ?? "Booking blocked",
      entitlementLabel: result.entitlement_label ?? "",
      creditsRemaining:
        result.credits_remaining === undefined ? null : result.credits_remaining,
      actionHint: result.action_hint ?? "",
      statusCode:
        (result.status_code as BlockedBookingResponse["statusCode"]) ??
        "no_entitlement",
    };
  }
  return {
    status: result.status as "booked" | "waitlisted",
    alreadyExists: result.already_exists ?? false,
  };
}

export async function cancelBooking(
  classSlug: string,
  memberSlug: string,
): Promise<{ result: "cancelled" | "late_cancel"; autoPromoted: number }> {
  const result = await callRpc<{
    result: string;
    auto_promoted: number;
  }>("sf_cancel_booking", { p_class_slug: classSlug, p_member_slug: memberSlug });
  return {
    result: result.result as "cancelled" | "late_cancel",
    autoPromoted: result.auto_promoted ?? 0,
  };
}

export async function promoteWaitlistEntry(
  classSlug: string,
  memberSlug: string,
): Promise<void> {
  await callRpc("sf_promote_member", {
    p_class_slug: classSlug,
    p_member_slug: memberSlug,
  });
}

export async function unpromoteEntry(
  classSlug: string,
  memberSlug: string,
  originalPosition: number,
): Promise<void> {
  await callRpc("sf_unpromote_member", {
    p_class_slug: classSlug,
    p_member_slug: memberSlug,
    p_original_position: originalPosition,
  });
}

/**
 * v0.8.3 attendance correction outcomes.
 *
 * 'checked_in' and 'no_show' are the post-close correction targets and
 * the live-class instructor-fallback targets. 'booked' is a live-only
 * revert used when an instructor mis-marked during class. Completed
 * classes reject 'booked' at the server-side — they are finalised.
 */
export type AttendanceOutcome = "checked_in" | "no_show" | "booked";

export type MarkAttendanceResult = {
  ok: true;
  outcome: AttendanceOutcome;
  previous: AttendanceOutcome;
  noop?: boolean;
};

export async function markAttendance(
  classSlug: string,
  memberSlug: string,
  outcome: AttendanceOutcome,
): Promise<MarkAttendanceResult> {
  const { data, error } = await requireClient().rpc("sf_mark_attendance", {
    p_class_slug: classSlug,
    p_member_slug: memberSlug,
    p_outcome: outcome,
  });
  if (error) {
    console.error("[sf_mark_attendance] RPC failed:", error.message);
    throw new Error(`sf_mark_attendance failed: ${error.message}`);
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    outcome?: string;
    previous?: string;
    noop?: boolean;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error("sf_mark_attendance: unexpected response");
  return {
    ok: true,
    outcome: result.outcome as AttendanceOutcome,
    previous: result.previous as AttendanceOutcome,
    noop: result.noop,
  };
}

/**
 * v0.8.3 check-in source. Both client-side paths (direct navigation
 * AND QR-scanned URL) use 'client'. The instructor fallback button in
 * the instructor view uses 'operator'. All sources converge on the
 * same sf_check_in RPC and produce the same booking_status=checked_in
 * state — the source only distinguishes the audit row.
 */
export type CheckInSource = "client" | "operator";

export type CheckInResult = {
  ok: true;
  source: CheckInSource;
};

export async function checkInMember(
  classSlug: string,
  memberSlug: string,
  source: CheckInSource,
): Promise<CheckInResult> {
  const { data, error } = await requireClient().rpc("sf_check_in", {
    p_class_slug: classSlug,
    p_member_slug: memberSlug,
    p_source: source,
  });
  if (error) {
    console.error("[sf_check_in] RPC failed:", error.message);
    throw new Error(`sf_check_in failed: ${error.message}`);
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    source?: string;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error("sf_check_in: unexpected response");
  return { ok: true, source: result.source as CheckInSource };
}

/**
 * v0.8.3 auto-close sweep. Idempotent. Safe to call from any view
 * that renders a completed class; the first visitor after class end
 * triggers the sweep of still-booked rows to no_show, subsequent
 * visits see the finalised state.
 */
export type FinaliseClassResult = {
  ok: true;
  swept: number;
  noop?: boolean;
};

export async function finaliseClass(
  classSlug: string,
): Promise<FinaliseClassResult> {
  const { data, error } = await requireClient().rpc("sf_finalise_class", {
    p_class_slug: classSlug,
  });
  if (error) {
    console.error("[sf_finalise_class] RPC failed:", error.message);
    throw new Error(`sf_finalise_class failed: ${error.message}`);
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    swept?: number;
    noop?: boolean;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error("sf_finalise_class: unexpected response");
  return { ok: true, swept: result.swept ?? 0, noop: result.noop };
}

export async function checkInAttendee(
  classSlug: string,
  memberSlug: string,
): Promise<void> {
  // Simple single-row update — no concurrency concern, keep as direct query
  const [{ data: cls }, { data: mem }] = await Promise.all([
    requireClient().from("classes").select("id").eq("slug", classSlug).single(),
    requireClient().from("members").select("id").eq("slug", memberSlug).single(),
  ]);
  if (!cls || !mem) throw new Error("Class or member not found");

  const { data: booking } = await requireClient()
    .from("class_bookings")
    .select("id")
    .eq("class_id", cls.id)
    .eq("member_id", mem.id)
    .eq("booking_status", "booked")
    .eq("is_active", true)
    .single();

  if (!booking) throw new Error("No active booking found for check-in");

  await requireClient()
    .from("class_bookings")
    .update({
      checked_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  await requireClient().from("booking_events").insert({
    class_id: cls.id,
    member_id: mem.id,
    booking_id: booking.id,
    event_type: "checked_in",
    event_label: "Checked in",
  });
}

// ── v0.8.0: manual credit adjustment + ledger reads ─────────────────

/**
 * Allowed operator reason codes for manual credit adjustments. This list
 * must stay in sync with `sf_adjust_credit`'s server-side `v_allowed`
 * array — if either side changes, update both. The DB is authoritative:
 * any code not in the server list is rejected with a structured error,
 * so the client never silently accepts unknown codes.
 */
export const MANUAL_ADJUST_REASONS = [
  "bereavement",
  "medical",
  "studio_error",
  "goodwill",
  "admin_correction",
  "service_recovery",
] as const;
export type ManualAdjustReason = (typeof MANUAL_ADJUST_REASONS)[number];

export type AdjustCreditResult = {
  ok: true;
  balanceAfter: number;
  ledgerId: string;
  delta: number;
  reasonCode: ManualAdjustReason;
};

/**
 * Call the atomic `sf_adjust_credit` RPC. Reason code is required. The
 * server locks the member row, clamps the resulting balance at 0, and
 * writes a single ledger row with source='operator'. On validation
 * failure the RPC returns `{error: "..."}` which we re-throw as an
 * Error so callers can display it.
 */
export async function adjustMemberCredit(
  memberSlug: string,
  delta: number,
  reasonCode: ManualAdjustReason,
  note: string | null,
): Promise<AdjustCreditResult> {
  const { data, error } = await requireClient().rpc("sf_adjust_credit", {
    p_member_slug: memberSlug,
    p_delta: delta,
    p_reason_code: reasonCode,
    p_note: note,
    p_operator_key: null,
  });
  if (error) {
    console.error("[sf_adjust_credit] RPC failed:", error.message);
    throw new Error(`sf_adjust_credit failed: ${error.message}`);
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    balance_after?: number;
    ledger_id?: string;
    delta?: number;
    reason_code?: string;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error("sf_adjust_credit: unexpected response");
  return {
    ok: true,
    balanceAfter: result.balance_after ?? 0,
    ledgerId: result.ledger_id ?? "",
    delta: result.delta ?? delta,
    reasonCode: result.reason_code as ManualAdjustReason,
  };
}

export type LedgerEntry = {
  id: string;
  delta: number;
  balanceAfter: number;
  reasonCode: string;
  source: "system" | "operator";
  note: string | null;
  classId: string | null;
  bookingId: string | null;
  createdAt: string;
};

/**
 * Fetch the most recent credit-ledger rows for a given member, newest
 * first. Used by the member-detail recent-ledger panel.
 */
export async function fetchRecentLedgerEntries(
  memberSlug: string,
  limit = 10,
): Promise<LedgerEntry[]> {
  const { data: mem } = await requireClient()
    .from("members")
    .select("id")
    .eq("slug", memberSlug)
    .single();
  if (!mem) return [];

  const { data, error } = await requireClient()
    .from("credit_transactions")
    .select("*")
    .eq("member_id", mem.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[fetchRecentLedgerEntries] query failed:", error.message);
    return [];
  }
  return (data as CreditTransactionRow[]).map((r) => ({
    id: r.id,
    delta: r.delta,
    balanceAfter: r.balance_after,
    reasonCode: r.reason_code,
    source: r.source,
    note: r.note,
    classId: r.class_id,
    bookingId: r.booking_id,
    createdAt: r.created_at,
  }));
}
