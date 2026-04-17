import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.8.4.2 QA fixture refresh endpoint.
 *
 * Self-activating. Instead of depending on the sf_refresh_qa_fixtures
 * PL/pgSQL function (which requires the v0.8.4.1 migration to have
 * been applied in the Supabase SQL Editor), this route drives the
 * entire fixture set via direct upserts, deletes, and inserts against
 * the same tables that production code reads. Outcome:
 *
 *   - If the QA member / class rows don't exist yet, they're created.
 *   - If they do exist, their timestamps and bookings are snapped back
 *     to the documented state relative to now().
 *   - A later application of the v0.8.4.1 migration is harmless — the
 *     row IDs conflict on slug and the constraint-safe upsert behaviour
 *     converges on the same state.
 *
 * No production classes or members are touched. Every write is scoped
 * to the qa-* slugs declared here.
 */

// v0.9.0: qa-drained is active class_pack with 0 credits remaining so
// live QA has a pure "no_credits" eligibility case. It never joins any
// fixture class roster — its purpose is to appear in the Add-member
// dropdown on the operator view and demonstrate a blocked booking.
const QA_MEMBER_SLUGS = ["qa-alex", "qa-blake", "qa-casey", "qa-drained"] as const;
type QaMemberSlug = (typeof QA_MEMBER_SLUGS)[number];

const QA_CLASS_SLUGS = [
  "qa-too-early",
  "qa-open",
  "qa-already-in",
  "qa-closed",
  "qa-correction",
] as const;
type QaClassSlug = (typeof QA_CLASS_SLUGS)[number];

function addMinutes(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

type FailureCode =
  | "no_client"
  | "member_upsert"
  | "class_upsert"
  | "class_lookup"
  | "member_lookup"
  | "booking_reset"
  | "booking_insert"
  | "audit_insert";

function fail(code: FailureCode, message: string, status = 500) {
  return NextResponse.json(
    { ok: false, stage: code, error: message },
    { status },
  );
}

async function handle() {
  const client = getSupabaseClient();
  if (!client) {
    return fail(
      "no_client",
      "Supabase client is not configured. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from the server environment.",
      503,
    );
  }

  const now = new Date();

  // ── 1. Upsert QA members ────────────────────────────────────────────
  // Alex / Blake / Casey stay on unlimited so check-in / attendance
  // scenarios are never gated by eligibility. Drained is a dedicated
  // class_pack-zero-credits member for the v0.9.0 no_credits QA path.
  const qaMembers: Array<{
    slug: QaMemberSlug;
    full_name: string;
    status: "active";
    plan_type: "unlimited" | "class_pack";
    plan_name: string;
    credits_remaining: number | null;
  }> = [
    {
      slug: "qa-alex",
      full_name: "QA Alex",
      status: "active",
      plan_type: "unlimited",
      plan_name: "QA Unlimited",
      credits_remaining: null,
    },
    {
      slug: "qa-blake",
      full_name: "QA Blake",
      status: "active",
      plan_type: "unlimited",
      plan_name: "QA Unlimited",
      credits_remaining: null,
    },
    {
      slug: "qa-casey",
      full_name: "QA Casey",
      status: "active",
      plan_type: "unlimited",
      plan_name: "QA Unlimited",
      credits_remaining: null,
    },
    {
      slug: "qa-drained",
      full_name: "QA Drained",
      status: "active",
      plan_type: "class_pack",
      plan_name: "QA 5-Class Pass",
      credits_remaining: 0,
    },
  ];
  {
    const { error } = await client
      .from("members")
      .upsert(qaMembers, { onConflict: "slug" });
    if (error) return fail("member_upsert", error.message);
  }

  // ── 2. Upsert QA classes with timestamps relative to now() ─────────────
  //
  // Note: check_in_window_minutes is deliberately omitted from the
  // upsert payload. The column exists only after the v0.8.4 migration
  // has been applied in the Supabase SQL Editor. When it is present it
  // defaults to 15 (the app's client-side fallback also assumes 15), so
  // omitting it keeps the refresh working on both pre- and post-v0.8.4
  // schemas. Testers who need actual DB-enforced window gating should
  // apply the v0.8.4 migration; the /qa matrix itself does not require
  // it.
  type QaClassRow = {
    slug: QaClassSlug;
    title: string;
    instructor_name: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
    location_name: string;
    cancellation_window_hours: number;
  };
  const qaClasses: QaClassRow[] = [
    {
      slug: "qa-too-early",
      title: "QA — Too Early",
      instructor_name: "QA Staff",
      starts_at: addMinutes(now, 60),
      ends_at: addMinutes(now, 120),
      capacity: 10,
      location_name: "QA Studio",
      cancellation_window_hours: 24,
    },
    {
      slug: "qa-open",
      title: "QA — Check-in Open",
      instructor_name: "QA Staff",
      starts_at: addMinutes(now, -5),
      ends_at: addMinutes(now, 55),
      capacity: 10,
      location_name: "QA Studio",
      cancellation_window_hours: 24,
    },
    {
      slug: "qa-already-in",
      title: "QA — Already Checked In",
      instructor_name: "QA Staff",
      starts_at: addMinutes(now, -5),
      ends_at: addMinutes(now, 55),
      capacity: 10,
      location_name: "QA Studio",
      cancellation_window_hours: 24,
    },
    {
      slug: "qa-closed",
      title: "QA — Closed",
      instructor_name: "QA Staff",
      starts_at: addMinutes(now, -90),
      ends_at: addMinutes(now, -30),
      capacity: 10,
      location_name: "QA Studio",
      cancellation_window_hours: 24,
    },
    {
      slug: "qa-correction",
      title: "QA — Correction Path",
      instructor_name: "QA Staff",
      starts_at: addMinutes(now, -180),
      ends_at: addMinutes(now, -120),
      capacity: 10,
      location_name: "QA Studio",
      cancellation_window_hours: 24,
    },
  ];
  {
    const { error } = await client
      .from("classes")
      .upsert(qaClasses, { onConflict: "slug" });
    if (error) return fail("class_upsert", error.message);
  }

  // ── 3. Resolve IDs by slug (needed for booking inserts) ────────────────
  const { data: classRows, error: classLookupErr } = await client
    .from("classes")
    .select("id, slug")
    .in("slug", QA_CLASS_SLUGS as readonly string[]);
  if (classLookupErr) return fail("class_lookup", classLookupErr.message);
  const classIdBySlug = new Map<QaClassSlug, string>();
  for (const r of classRows ?? []) {
    classIdBySlug.set(r.slug as QaClassSlug, r.id as string);
  }
  const missingClasses = QA_CLASS_SLUGS.filter((s) => !classIdBySlug.has(s));
  if (missingClasses.length > 0) {
    return fail(
      "class_lookup",
      `QA classes missing after upsert: ${missingClasses.join(", ")}`,
    );
  }

  const { data: memberRows, error: memberLookupErr } = await client
    .from("members")
    .select("id, slug")
    .in("slug", QA_MEMBER_SLUGS as readonly string[]);
  if (memberLookupErr) return fail("member_lookup", memberLookupErr.message);
  const memberIdBySlug = new Map<QaMemberSlug, string>();
  for (const r of memberRows ?? []) {
    memberIdBySlug.set(r.slug as QaMemberSlug, r.id as string);
  }
  const missingMembers = QA_MEMBER_SLUGS.filter((s) => !memberIdBySlug.has(s));
  if (missingMembers.length > 0) {
    return fail(
      "member_lookup",
      `QA members missing after upsert: ${missingMembers.join(", ")}`,
    );
  }

  const classIds = [...classIdBySlug.values()];

  // ── 4. Wipe QA-only bookings + events (scoped strictly by class_id) ────
  {
    const { error: evErr } = await client
      .from("booking_events")
      .delete()
      .in("class_id", classIds);
    if (evErr) return fail("booking_reset", evErr.message);
  }
  {
    const { error: bkErr } = await client
      .from("class_bookings")
      .delete()
      .in("class_id", classIds);
    if (bkErr) return fail("booking_reset", bkErr.message);
  }

  // ── 5. Rebuild bookings per fixture ────────────────────────────────────
  const alex = memberIdBySlug.get("qa-alex")!;
  const blake = memberIdBySlug.get("qa-blake")!;
  const casey = memberIdBySlug.get("qa-casey")!;
  const tooEarly = classIdBySlug.get("qa-too-early")!;
  const open = classIdBySlug.get("qa-open")!;
  const alreadyIn = classIdBySlug.get("qa-already-in")!;
  const closed = classIdBySlug.get("qa-closed")!;
  const correction = classIdBySlug.get("qa-correction")!;

  const bookings = [
    // qa-too-early: two booked members
    { class_id: tooEarly, member_id: alex, booking_status: "booked", is_active: true },
    { class_id: tooEarly, member_id: blake, booking_status: "booked", is_active: true },
    // qa-open: three booked members
    { class_id: open, member_id: alex, booking_status: "booked", is_active: true },
    { class_id: open, member_id: blake, booking_status: "booked", is_active: true },
    { class_id: open, member_id: casey, booking_status: "booked", is_active: true },
    // qa-already-in: alex pre-checked-in, blake booked
    {
      class_id: alreadyIn,
      member_id: alex,
      booking_status: "checked_in",
      checked_in_at: now.toISOString(),
      is_active: true,
    },
    { class_id: alreadyIn, member_id: blake, booking_status: "booked", is_active: true },
    // qa-closed: one checked_in, one no_show
    {
      class_id: closed,
      member_id: alex,
      booking_status: "checked_in",
      checked_in_at: addMinutes(now, -75),
      is_active: true,
    },
    { class_id: closed, member_id: blake, booking_status: "no_show", is_active: true },
    // qa-correction: two checked_in + one no_show
    {
      class_id: correction,
      member_id: alex,
      booking_status: "checked_in",
      checked_in_at: addMinutes(now, -165),
      is_active: true,
    },
    {
      class_id: correction,
      member_id: blake,
      booking_status: "no_show",
      is_active: true,
    },
    {
      class_id: correction,
      member_id: casey,
      booking_status: "checked_in",
      checked_in_at: addMinutes(now, -165),
      is_active: true,
    },
  ];

  const { data: insertedBookings, error: insertErr } = await client
    .from("class_bookings")
    .insert(bookings)
    .select("id, class_id, member_id, booking_status");
  if (insertErr) return fail("booking_insert", insertErr.message);

  // ── 6. Seed the audit row for qa-already-in's pre-checked-in member ────
  const alreadyInCheckedIn = (insertedBookings ?? []).find(
    (b) => b.class_id === alreadyIn && b.booking_status === "checked_in",
  );
  if (alreadyInCheckedIn) {
    const { error: auditErr } = await client.from("booking_events").insert({
      class_id: alreadyInCheckedIn.class_id,
      member_id: alreadyInCheckedIn.member_id,
      booking_id: alreadyInCheckedIn.id,
      event_type: "checked_in",
      event_label: "Checked in (qa_fixture)",
      metadata: { source: "qa_fixture" },
    });
    if (auditErr) return fail("audit_insert", auditErr.message);
  }

  return NextResponse.json({
    ok: true,
    mode: "direct",
    refreshedAt: now.toISOString(),
    fixtures: QA_CLASS_SLUGS,
    memberIds: Object.fromEntries(memberIdBySlug),
    classIds: Object.fromEntries(classIdBySlug),
  });
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
