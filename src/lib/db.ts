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
  // Map DB status back to app status
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

// ── Read queries ────────────────────────────────────────────────────

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
    .not("plan_type", "eq", "drop_in") // hide stub walk-in members
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
  // First get the class UUID
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

// ── Write mutations ─────────────────────────────────────────────────

async function resolveIds(
  classSlug: string,
  memberSlug: string,
): Promise<{ classId: string; memberId: string } | null> {
  const [{ data: cls }, { data: mem }] = await Promise.all([
    requireClient().from("classes").select("id").eq("slug", classSlug).single(),
    requireClient().from("members").select("id").eq("slug", memberSlug).single(),
  ]);
  if (!cls || !mem) return null;
  return { classId: cls.id, memberId: mem.id };
}

/**
 * FIFO auto-promote: if an upcoming class has capacity, promote the
 * lowest-position waitlisted entry. Persists to class_bookings + booking_events.
 */
async function autoPromoteIfNeeded(classId: string): Promise<void> {
  // Check lifecycle — only auto-promote upcoming classes
  const { data: cls } = await requireClient()
    .from("classes")
    .select("capacity, starts_at, ends_at")
    .eq("id", classId)
    .single();

  if (!cls) return;
  const lifecycle = deriveLifecycle(cls.starts_at, cls.ends_at);
  if (lifecycle !== "upcoming") return;

  // Count current booked attendees
  const { count: bookedCount } = await requireClient()
    .from("class_bookings")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .eq("is_active", true)
    .neq("booking_status", "waitlisted")
    .not("booking_status", "in", '("cancelled","late_cancel")');

  if ((bookedCount ?? 0) >= cls.capacity) return;

  // Get next waitlisted entry (lowest position)
  const { data: nextWait } = await requireClient()
    .from("class_bookings")
    .select("id, member_id, waitlist_position")
    .eq("class_id", classId)
    .eq("booking_status", "waitlisted")
    .eq("is_active", true)
    .order("waitlist_position", { ascending: true })
    .limit(1)
    .single();

  if (!nextWait) return;

  // Promote
  await requireClient()
    .from("class_bookings")
    .update({
      booking_status: "booked",
      promotion_source: "auto",
      promoted_at: new Date().toISOString(),
      waitlist_position: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nextWait.id);

  // Log event
  await requireClient().from("booking_events").insert({
    class_id: classId,
    member_id: nextWait.member_id,
    booking_id: nextWait.id,
    event_type: "promoted_auto",
    event_label: `Auto-promoted from waitlist #${nextWait.waitlist_position}`,
    metadata: { original_position: nextWait.waitlist_position },
  });

  // Recurse — there may be more capacity
  await autoPromoteIfNeeded(classId);
}

export async function promoteWaitlistEntry(
  classSlug: string,
  memberSlug: string,
): Promise<void> {
  const ids = await resolveIds(classSlug, memberSlug);
  if (!ids) return;

  // Find the waitlisted booking
  const { data: booking } = await requireClient()
    .from("class_bookings")
    .select("id, waitlist_position")
    .eq("class_id", ids.classId)
    .eq("member_id", ids.memberId)
    .eq("booking_status", "waitlisted")
    .eq("is_active", true)
    .single();

  if (!booking) return;

  // Update to booked
  await requireClient()
    .from("class_bookings")
    .update({
      booking_status: "booked",
      promotion_source: "manual",
      promoted_at: new Date().toISOString(),
      waitlist_position: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  // Log event
  await requireClient().from("booking_events").insert({
    class_id: ids.classId,
    member_id: ids.memberId,
    booking_id: booking.id,
    event_type: "promoted_manual",
    event_label: `Promoted from waitlist #${booking.waitlist_position}`,
    metadata: { original_position: booking.waitlist_position },
  });

  // Check if any auto-promotions should fire
  await autoPromoteIfNeeded(ids.classId);
}

export async function unpromoteEntry(
  classSlug: string,
  memberSlug: string,
  originalPosition: number,
): Promise<void> {
  const ids = await resolveIds(classSlug, memberSlug);
  if (!ids) return;

  // Find the promoted booking
  const { data: booking } = await requireClient()
    .from("class_bookings")
    .select("id")
    .eq("class_id", ids.classId)
    .eq("member_id", ids.memberId)
    .eq("booking_status", "booked")
    .eq("promotion_source", "manual")
    .eq("is_active", true)
    .single();

  if (!booking) return;

  // Revert to waitlisted
  await requireClient()
    .from("class_bookings")
    .update({
      booking_status: "waitlisted",
      promotion_source: null,
      promoted_at: null,
      waitlist_position: originalPosition,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  // Revoke any auto-promotions that were occupying space this manual entry now vacates
  // The auto-promote will re-run and re-derive the correct state
  // First, un-auto-promote existing auto entries that are beyond capacity
  const { data: autoEntries } = await requireClient()
    .from("class_bookings")
    .select("id, member_id")
    .eq("class_id", ids.classId)
    .eq("promotion_source", "auto")
    .eq("booking_status", "booked")
    .eq("is_active", true);

  // Get current class data to check if we need to revert any auto entries
  const { data: cls } = await requireClient()
    .from("classes")
    .select("capacity")
    .eq("id", ids.classId)
    .single();

  if (cls && autoEntries) {
    // Count non-auto booked entries
    const { count: nonAutoCount } = await requireClient()
      .from("class_bookings")
      .select("id", { count: "exact", head: true })
      .eq("class_id", ids.classId)
      .eq("is_active", true)
      .eq("booking_status", "booked")
      .is("promotion_source", null);

    // Also count manual promotions
    const { count: manualCount } = await requireClient()
      .from("class_bookings")
      .select("id", { count: "exact", head: true })
      .eq("class_id", ids.classId)
      .eq("is_active", true)
      .eq("booking_status", "booked")
      .eq("promotion_source", "manual");

    const baseBooked = (nonAutoCount ?? 0) + (manualCount ?? 0);
    const slotsForAuto = Math.max(0, cls.capacity - baseBooked);

    // If there are more auto entries than available slots, revert extras
    if (autoEntries.length > slotsForAuto) {
      const toRevert = autoEntries.slice(slotsForAuto);
      for (const entry of toRevert) {
        // Look up original position from booking_events
        const { data: origEvent } = await requireClient()
          .from("booking_events")
          .select("metadata")
          .eq("booking_id", entry.id)
          .eq("event_type", "promoted_auto")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        const origPos = (origEvent?.metadata as Record<string, unknown>)?.original_position as number | undefined;

        await requireClient()
          .from("class_bookings")
          .update({
            booking_status: "waitlisted",
            promotion_source: null,
            promoted_at: null,
            waitlist_position: origPos ?? 999,
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id);
      }
    }
  }

  // Log unpromote event
  await requireClient().from("booking_events").insert({
    class_id: ids.classId,
    member_id: ids.memberId,
    booking_id: booking.id,
    event_type: "unpromoted",
    event_label: `Promotion reverted (back to waitlist #${originalPosition})`,
    metadata: { original_position: originalPosition },
  });

  // Re-run auto-promote to fill any remaining capacity
  await autoPromoteIfNeeded(ids.classId);
}

export async function checkInAttendee(
  classSlug: string,
  memberSlug: string,
): Promise<void> {
  const ids = await resolveIds(classSlug, memberSlug);
  if (!ids) return;

  const { data: booking } = await requireClient()
    .from("class_bookings")
    .select("id")
    .eq("class_id", ids.classId)
    .eq("member_id", ids.memberId)
    .eq("booking_status", "booked")
    .eq("is_active", true)
    .single();

  if (!booking) return;

  await requireClient()
    .from("class_bookings")
    .update({
      checked_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  await requireClient().from("booking_events").insert({
    class_id: ids.classId,
    member_id: ids.memberId,
    booking_id: booking.id,
    event_type: "checked_in",
    event_label: "Checked in",
  });
}
