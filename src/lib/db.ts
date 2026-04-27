import { getSupabaseClient } from "./supabase";
import type { Plan, PlanType } from "./plans";
import type {
  MemberAccessRow,
  ClassRow,
  BookingRow,
  BookingEventRow,
  CreditTransactionRow,
  AccessJson,
} from "./database.types";
import type {
  StudioClass,
  Attendee,
  WaitlistEntry,
  Lifecycle,
  CheckInStatus,
} from "@/app/app/classes/data";
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

// v0.8.4 check-in window derivation. Client-side so every UI surface
// speaks the same truth without a network round-trip. The DB is still
// the authoritative backstop — sf_check_in re-evaluates on the same
// rule using its own now() and the persisted window_minutes.
function deriveCheckInStatus(
  startsAt: string,
  endsAt: string,
  windowMinutes: number,
): { status: CheckInStatus; opensAt: string } {
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const opens = start - windowMinutes * 60_000;
  const opensAt = new Date(opens).toISOString();
  if (end < now) return { status: "closed", opensAt };
  if (now < opens) return { status: "pre_window", opensAt };
  return { status: "open", opensAt };
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
  // v0.9.4.1: members.status is deliberately NOT mapped onto the app
  // Member model. Account status is not a StudioFlow product concept at
  // this phase; the DB column still exists (untouched by this release)
  // but the app layer does not surface it.
  return {
    id: r.slug,
    name: r.full_name,
    plan: r.plan_name,
    planType: r.plan_type,
    credits: r.plan_type === "unlimited" ? null : (r.credits_remaining ?? 0),
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
  // v0.8.4: canonical statuses are booked / checked_in / late_cancel /
  // no_show. The DB constraint now forbids legacy 'attended'; we still
  // defensively coerce any stale read just in case a caller hits this
  // before the schema migration has been applied in that environment.
  return bookings
    .filter((b) => b.booking_status !== "waitlisted" && b.is_active)
    .map((b) => {
      const originalPosition = promotionMeta.get(b.id);
      const status: Attendee["status"] =
        (b.booking_status as string) === "attended"
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

  // v0.8.4: fall back to the default 15 minutes if the column is
  // missing (environment not yet migrated). Keeps the UI rendering
  // instead of crashing on an undefined column.
  const windowMinutes =
    typeof cls.check_in_window_minutes === "number"
      ? cls.check_in_window_minutes
      : 15;
  const { status: checkInStatus, opensAt: checkInOpensAt } =
    deriveCheckInStatus(cls.starts_at, cls.ends_at, windowMinutes);

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
    checkInStatus,
    checkInWindowMinutes: windowMinutes,
    checkInOpensAt,
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

/**
 * v0.8.4 gated-rejection status codes. These come from sf_check_in when
 * the call is rejected because of the window or booking state, and let
 * the UI render a specific message rather than parsing the prose.
 *
 *   too_early  — call arrived before (starts_at - check_in_window_minutes)
 *   closed     — class has ended; no fresh client check-in allowed
 *   not_booked — waitlisted / cancelled / late_cancel / no booking
 */
export type CheckInRejectionCode = "too_early" | "closed" | "not_booked";

export type CheckInSuccess = {
  ok: true;
  source: CheckInSource;
  // v0.8.4: set when the call was idempotent — the member was already
  // checked in. No state flipped, no audit event was written. The UI
  // should render "Already checked in" as a success, not an error.
  alreadyCheckedIn: boolean;
};

export type CheckInRejection = {
  ok: false;
  code: CheckInRejectionCode;
  message: string;
  // Present when code === 'too_early'; ISO timestamp the window opens.
  opensAt?: string;
};

export type CheckInResult = CheckInSuccess | CheckInRejection;

function isRejectionCode(v: unknown): v is CheckInRejectionCode {
  return v === "too_early" || v === "closed" || v === "not_booked";
}

export async function checkInMember(
  classSlug: string,
  memberSlug: string,
  source: CheckInSource,
): Promise<CheckInResult> {
  // v0.8.4.3: call the server-side TypeScript implementation at
  // /api/attendance/check-in instead of the sf_check_in RPC. The
  // route enforces the v0.8.4 window and idempotency semantics
  // even when the v0.8.4 DB migration has not been applied — it
  // is the canonical backend from the browser's perspective.
  //
  // Gated rejections (too_early / closed / not_booked) come back as
  // HTTP 200 with { ok:false, code, message, opensAt? } — those are
  // normal domain outcomes and must NOT be thrown. Non-domain failures
  // (lookup errors, missing member/class, invalid source, transport
  // errors) throw so they surface on the error-boundary path.
  let body: {
    ok?: boolean;
    source?: string;
    alreadyCheckedIn?: boolean;
    noop?: boolean;
    code?: string;
    message?: string;
    opensAt?: string;
  };
  try {
    const res = await fetch("/api/attendance/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classSlug, memberSlug, source }),
    });
    body = await res.json();
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `check-in request failed: ${e.message}`
        : "check-in request failed",
    );
  }

  if (body.ok) {
    return {
      ok: true,
      source: (body.source as CheckInSource) ?? source,
      alreadyCheckedIn: Boolean(body.alreadyCheckedIn),
    };
  }

  if (isRejectionCode(body.code)) {
    return {
      ok: false,
      code: body.code,
      message: body.message ?? "Check-in blocked",
      opensAt: body.opensAt,
    };
  }

  throw new Error(body.message ?? "check-in failed");
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

// ── v0.8.4.1: QA fixtures + temporal test control ────────────────────

/**
 * Slugs of the deterministic QA fixture classes shipped in v0.8.4.1.
 * Centralised here so the UI + QA landing page share one source of
 * truth. Every entry has a corresponding class row seeded by the
 * migration and refreshed to spec by sf_refresh_qa_fixtures.
 */
export const QA_FIXTURES = [
  {
    slug: "qa-too-early",
    scenario: "too-early",
    label: "Too early — check-in not open yet",
    description:
      "Pre-window state. The client check-in page should say the window hasn't opened and show the clock time it will.",
  },
  {
    slug: "qa-open",
    scenario: "open",
    label: "Check-in open — fresh roster",
    description:
      "Three booked QA members ready to self-check-in. The first tap flips the row and writes a single audit row.",
  },
  {
    slug: "qa-already-in",
    scenario: "already-in",
    label: "Already checked in — idempotent",
    description:
      "QA Alex is pre-checked-in. Tapping the row demonstrates the idempotent success path — no duplicate audit row.",
  },
  {
    slug: "qa-closed",
    scenario: "closed",
    label: "Closed — check-in blocked",
    description:
      "Class ended 30 min ago. Client check-in is blocked; staff correction is the only path.",
  },
  {
    slug: "qa-correction",
    scenario: "correction",
    label: "Completed correction path",
    description:
      "Ended 2 h ago with mixed checked_in / no_show rows. Use the instructor view to flip statuses and observe correction_* events appended to the audit log.",
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  scenario: "too-early" | "open" | "already-in" | "closed" | "correction";
  label: string;
  description: string;
}>;

export type QaScenario = (typeof QA_FIXTURES)[number]["scenario"];

/**
 * Look up the QA scenario label for a class slug, or null for any
 * production (non-QA) slug. Used by the /checkin and /instructor
 * pages to render a small "QA: X" banner on fixture pages without
 * mixing QA concerns into the production UI code paths.
 */
export function qaFixtureFor(slug: string): (typeof QA_FIXTURES)[number] | null {
  return QA_FIXTURES.find((f) => f.slug === slug) ?? null;
}

export type RefreshQaFixturesResult = {
  ok: true;
  refreshedAt: string;
  fixtures: readonly string[];
  mode: "direct";
};

export type RefreshQaFixturesError = {
  ok: false;
  stage: string;
  message: string;
};

/**
 * Idempotent fixture refresh. Calls the /api/qa/refresh API route,
 * which in v0.8.4.2 drives the whole fixture set via direct table
 * upserts and no longer depends on the sf_refresh_qa_fixtures RPC.
 * Returns a typed success or a typed error — the UI can show the
 * specific stage that failed rather than a generic message.
 */
export async function refreshQaFixtures(): Promise<
  RefreshQaFixturesResult | RefreshQaFixturesError
> {
  try {
    const res = await fetch("/api/qa/refresh", { method: "POST" });
    const body = (await res.json()) as {
      ok?: boolean;
      stage?: string;
      error?: string;
      refreshedAt?: string;
      fixtures?: string[];
      mode?: string;
    };
    if (res.ok && body.ok) {
      return {
        ok: true,
        refreshedAt: body.refreshedAt ?? new Date().toISOString(),
        fixtures: body.fixtures ?? [],
        mode: "direct",
      };
    }
    return {
      ok: false,
      stage: body.stage ?? "unknown",
      message: body.error ?? `Refresh failed with HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      stage: "transport",
      message: e instanceof Error ? e.message : "Network error contacting /api/qa/refresh",
    };
  }
}

/**
 * Read-only readiness probe. Returns what the DB has right now —
 * counts of the expected fixture rows and the slugs that are still
 * missing. Used by /qa to reflect the true environment state rather
 * than implying everything is fine when it isn't.
 */
export type QaEnvironmentStatus = {
  ready: boolean;
  reason?: string;
  missingClasses: string[];
  missingMembers: string[];
  fixtureCount: number;
};

export async function fetchQaStatus(): Promise<QaEnvironmentStatus> {
  const res = await fetch("/api/qa/status", { cache: "no-store" });
  const body = (await res.json()) as Partial<QaEnvironmentStatus>;
  return {
    ready: body.ready ?? false,
    reason: body.reason,
    missingClasses: body.missingClasses ?? [],
    missingMembers: body.missingMembers ?? [],
    fixtureCount: body.fixtureCount ?? 0,
  };
}

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

// ── v0.13.1: purchase history reader ────────────────────────────────

/**
 * A single row from the v0.13.0 `purchases` table, projected onto a
 * camelCase shape for the operator member-detail surface. Mirrors the
 * TS convention used for ledger + audit reads above.
 */
/**
 * v0.13.1 + v0.15.0 purchase row projection.
 *
 * `source` accepts the legacy 'fake' value so historical pre-v0.15.0
 * rows still resolve; new code paths emit only 'stripe', 'dev_fake',
 * or 'operator_manual'. `status` is always 'completed' for now —
 * 'failed' / 'refunded' / 'cancelled' exist as future-proofing but no
 * current code path writes them.
 */
export type PurchaseSourceRecorded =
  | "stripe"
  | "fake"
  | "dev_fake"
  | "operator_manual";

export type PurchaseStatus = "completed" | "failed" | "refunded" | "cancelled";

export type PurchaseRecord = {
  id: string;
  planId: string;
  source: PurchaseSourceRecorded;
  externalId: string;
  status: PurchaseStatus;
  /** v0.15.0: amount paid recorded at apply time. NULL on legacy rows. */
  priceCentsPaid: number | null;
  /** v0.15.0: credits added at apply time. NULL on unlimited and legacy rows. */
  creditsGranted: number | null;
  createdAt: string;
};

/**
 * Recent purchases for one member, newest first. Used by the
 * operator Purchase history panel on /app/members/[id]. Returns
 * an empty array (not an error) if the member has no purchases
 * yet — that's the normal state for members who haven't hit the
 * checkout flow.
 */
export async function fetchMemberPurchases(
  memberSlug: string,
  limit = 10,
): Promise<PurchaseRecord[]> {
  const { data: mem } = await requireClient()
    .from("members")
    .select("id")
    .eq("slug", memberSlug)
    .single();
  if (!mem) return [];

  const { data, error } = await requireClient()
    .from("purchases")
    .select(
      "id, plan_id, source, external_id, status, price_cents_paid, credits_granted, created_at",
    )
    .eq("member_id", mem.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[fetchMemberPurchases] query failed:",
      error.message,
    );
    return [];
  }
  return (data as Array<{
    id: string;
    plan_id: string;
    source: PurchaseSourceRecorded;
    external_id: string;
    status: PurchaseStatus;
    price_cents_paid: number | null;
    credits_granted: number | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    planId: r.plan_id,
    source: r.source,
    externalId: r.external_id,
    status: r.status,
    priceCentsPaid: r.price_cents_paid,
    creditsGranted: r.credits_granted,
    createdAt: r.created_at,
  }));
}

// ── v0.14.0: plan catalogue reader (client-side) ───────────────────

type PlanRowShape = {
  id: string;
  name: string;
  type: PlanType;
  price_cents: number;
  credits: number | null;
  active: boolean;
  created_at: string;
};

/**
 * Read all plans for the client store slice. Includes inactive rows;
 * the consumer filters for the member-facing purchase surface, and
 * the operator admin page shows active + inactive together.
 */
export async function fetchAllPlans(): Promise<Plan[]> {
  const { data, error } = await requireClient()
    .from("plans")
    .select("id, name, type, price_cents, credits, active, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[fetchAllPlans] query failed:", error.message);
    return [];
  }
  return (data as PlanRowShape[]).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    priceCents: r.price_cents,
    credits: r.credits,
    active: r.active,
    createdAt: r.created_at,
  }));
}
