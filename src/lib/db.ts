import { getSupabaseClient } from "./supabase";
import type { MemberRow, ClassRow, BookingRow, BookingEventRow } from "./database.types";
import type { StudioClass, Attendee, WaitlistEntry, Lifecycle } from "@/app/app/classes/data";
import type {
  Member,
  MemberInsights,
  PurchaseInsights,
  OpportunitySignal,
  HistoryEvent,
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

function mapMemberRow(r: MemberRow): Member {
  let appStatus: "active" | "expiring" | "expired";
  if (r.status === "inactive") {
    appStatus = "expired";
  } else if (
    r.status === "active" &&
    r.credits_remaining !== null &&
    r.credits_remaining <= 1 &&
    r.plan_type === "class_pack"
  ) {
    appStatus = "expiring";
  } else {
    appStatus = "active";
  }

  return {
    id: r.slug,
    name: r.full_name,
    plan: r.plan_name,
    credits: r.plan_type === "unlimited" ? null : (r.credits_remaining ?? 0),
    status: appStatus,
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
  return bookings
    .filter((b) => b.booking_status !== "waitlisted" && b.is_active)
    .map((b) => {
      let status: Attendee["status"];
      if (b.booking_status === "booked" && b.checked_in_at) {
        status = "checked_in";
      } else if (b.booking_status === "booked" && !b.checked_in_at) {
        status = "not_checked_in";
      } else {
        status = b.booking_status as Attendee["status"];
      }

      const originalPosition = promotionMeta.get(b.id);

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
  const { data, error } = await requireClient()
    .from("members")
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
  return (data as MemberRow[]).map(mapMemberRow);
}

export async function fetchMemberBySlug(slug: string): Promise<Member | null> {
  const { data, error } = await requireClient()
    .from("members")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return mapMemberRow(data as MemberRow);
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

export async function bookMemberIntoClass(
  classSlug: string,
  memberSlug: string,
): Promise<{ status: "booked" | "waitlisted"; alreadyExists?: boolean }> {
  const result = await callRpc<{
    status: string;
    booking_id: string;
    already_exists?: boolean;
  }>("sf_book_member", { p_class_slug: classSlug, p_member_slug: memberSlug });
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
