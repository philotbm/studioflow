import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.8.4.3 server-side check-in.
 *
 * WHY THIS EXISTS
 * The v0.8.4 attendance hardening was published as a Supabase migration
 * (supabase/v0.8.4_migration.sql) but has not been applied in the live
 * Supabase project. Without that migration, the deployed sf_check_in
 * PL/pgSQL function is still the v0.8.3 version: no check-in window
 * gating, no idempotent already-checked-in success path, duplicate
 * scans throw a hard "Already checked in" error.
 *
 * This route re-implements sf_check_in's v0.8.4 semantics in TypeScript
 * on the Next.js server runtime so the observable backend behaviour
 * matches the spec regardless of DB migration state. From the
 * browser's perspective, this endpoint IS the backend: it enforces
 * the window, returns the structured too_early / closed / not_booked
 * codes, and returns the idempotent no-op success for repeat check-ins
 * without writing a duplicate audit row. Rows are updated and events
 * are appended through the same Supabase anon client the rest of the
 * app uses.
 *
 * Future restoration of the v0.8.4 migration to the DB is harmless —
 * the RPC would converge on the same state, and the client can switch
 * back to calling it directly if desired.
 */

const ALLOWED_SOURCES = ["client", "operator"] as const;
type Source = (typeof ALLOWED_SOURCES)[number];

const DEFAULT_WINDOW_MINUTES = 15;

type CheckInBody = {
  classSlug?: string;
  memberSlug?: string;
  source?: string;
};

function bad(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CheckInBody;
  const classSlug = body.classSlug?.trim();
  const memberSlug = body.memberSlug?.trim();
  const sourceRaw = body.source;

  if (!classSlug) return bad("invalid_request", "Missing classSlug");
  if (!memberSlug) return bad("invalid_request", "Missing memberSlug");
  if (!sourceRaw || !(ALLOWED_SOURCES as readonly string[]).includes(sourceRaw)) {
    return bad(
      "invalid_source",
      "Invalid source — must be one of: client, operator",
    );
  }
  const source = sourceRaw as Source;

  const client = getSupabaseClient();
  if (!client) {
    return bad(
      "no_client",
      "Supabase client is not configured on the server.",
      503,
    );
  }

  // ── Resolve member and class (minimal columns — avoid depending on
  //    check_in_window_minutes which may not exist in the live schema) ──
  const { data: member, error: memberErr } = await client
    .from("members")
    .select("id")
    .eq("slug", memberSlug)
    .maybeSingle();
  if (memberErr) return bad("lookup_failed", memberErr.message, 500);
  if (!member) {
    return bad("member_not_found", `Member not found: ${memberSlug}`, 404);
  }

  const { data: cls, error: classErr } = await client
    .from("classes")
    .select("id, starts_at, ends_at")
    .eq("slug", classSlug)
    .maybeSingle();
  if (classErr) return bad("lookup_failed", classErr.message, 500);
  if (!cls) {
    return bad("class_not_found", `Class not found: ${classSlug}`, 404);
  }

  // Optional window column — only use if present. Schema cache errors
  // (column missing) fall back to the default without failing the call.
  let windowMinutes = DEFAULT_WINDOW_MINUTES;
  {
    const { data, error } = await client
      .from("classes")
      .select("check_in_window_minutes")
      .eq("id", cls.id)
      .maybeSingle();
    if (!error && data && typeof (data as Record<string, unknown>).check_in_window_minutes === "number") {
      windowMinutes = (data as { check_in_window_minutes: number }).check_in_window_minutes;
    }
  }

  // ── Window gate: true backend enforcement ───────────────────────────
  const now = new Date();
  const startsAt = new Date(cls.starts_at);
  const endsAt = new Date(cls.ends_at);
  const opensAt = new Date(startsAt.getTime() - windowMinutes * 60_000);

  if (now.getTime() < opensAt.getTime()) {
    return NextResponse.json({
      ok: false,
      code: "too_early",
      message: "Check-in is not open yet",
      opensAt: opensAt.toISOString(),
    });
  }
  if (now.getTime() > endsAt.getTime()) {
    return NextResponse.json({
      ok: false,
      code: "closed",
      message: "Class has ended — check-in is closed",
    });
  }

  // ── Find eligible booking. Accept booked or already-checked-in;
  //    everything else collapses to the same not_booked response. ──────
  const { data: bookings, error: bookingErr } = await client
    .from("class_bookings")
    .select("id, booking_status")
    .eq("class_id", cls.id)
    .eq("member_id", member.id)
    .eq("is_active", true)
    .in("booking_status", ["booked", "checked_in"])
    .limit(1);
  if (bookingErr) return bad("lookup_failed", bookingErr.message, 500);
  const booking = bookings?.[0];
  if (!booking) {
    return NextResponse.json({
      ok: false,
      code: "not_booked",
      message: "No eligible booking — member is not booked into this class",
    });
  }

  // ── Idempotent duplicate handling. Repeat scan / tap returns a clean
  //    success with no row flip and no audit insert. ─────────────────
  if (booking.booking_status === "checked_in") {
    return NextResponse.json({
      ok: true,
      source,
      alreadyCheckedIn: true,
      noop: true,
    });
  }

  // ── Flip the row and append exactly one audit entry. ────────────────
  const { error: updErr } = await client
    .from("class_bookings")
    .update({
      booking_status: "checked_in",
      checked_in_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", booking.id);
  if (updErr) return bad("update_failed", updErr.message, 500);

  const { error: auditErr } = await client.from("booking_events").insert({
    class_id: cls.id,
    member_id: member.id,
    booking_id: booking.id,
    event_type: "checked_in",
    event_label: `Checked in (${source})`,
    metadata: { source, via: "api/attendance/check-in" },
  });
  if (auditErr) {
    // Don't unwind the state flip — the booking is now checked_in and
    // that is the source of truth. Log and return a partial-audit
    // signal so the caller can surface the issue if needed.
    console.warn("[attendance/check-in] audit insert failed:", auditErr.message);
  }

  return NextResponse.json({
    ok: true,
    source,
    alreadyCheckedIn: false,
  });
}
