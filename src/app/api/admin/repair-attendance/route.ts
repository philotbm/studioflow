import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
/**
 * v0.8.4.3 attendance repair endpoint.
 *
 * One-shot, idempotent data normalisation. Updates any remaining
 * class_bookings rows with the legacy booking_status='attended'
 * (pre-v0.8.3 vocabulary) to 'checked_in'. Safe to re-run — once the
 * legacy set is empty the call is a no-op.
 *
 * This is the non-DDL half of the v0.8.4 vocabulary lock: the DB-side
 * CHECK-constraint tightening requires an ALTER TABLE that only a
 * service-role / admin session can issue, so that remains in
 * supabase/v0.8.4_migration.sql for the human operator to apply. This
 * endpoint covers everything the anon client CAN safely do: it drains
 * legacy rows out of the live set so the app speaks one attendance
 * language end to end.
 *
 * Scoped strictly to class_bookings rows where booking_status='attended'.
 * No other table is touched.
 */

export const POST = wrapRouteHandlerWithSentry(
  async function POST() {
  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase client is not configured on the server." },
      { status: 503 },
    );
  }

  // Count first so we can report a meaningful result on a no-op run.
  const { count, error: countErr } = await client
    .from("class_bookings")
    .select("id", { count: "exact", head: true })
    .eq("booking_status", "attended");
  if (countErr) {
    return NextResponse.json(
      { ok: false, error: countErr.message },
      { status: 500 },
    );
  }

  if ((count ?? 0) === 0) {
    return NextResponse.json({ ok: true, normalised: 0, noop: true });
  }

  const { error: updErr } = await client
    .from("class_bookings")
    .update({
      booking_status: "checked_in",
      updated_at: new Date().toISOString(),
    })
    .eq("booking_status", "attended");
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: updErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, normalised: count });
},
  { method: "POST", parameterizedRoute: "/api/admin/repair-attendance" },
);

export const GET = wrapRouteHandlerWithSentry(
  async function GET() {
  return POST();
},
  { method: "GET", parameterizedRoute: "/api/admin/repair-attendance" },
);
