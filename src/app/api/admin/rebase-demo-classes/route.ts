import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
// TODO(post-M3): this cron iterates every classes row but doesn't filter
// by studio. Pre-M3 (single studio) that was fine. Post-M3 it's
// implicitly safe because scopedQuery's proxy now scopes every
// .from('classes') query to the operator's studio_id — but the cron is
// only really meaningful for the demo studio's seeded classes. Two
// follow-ups to consider:
//   (a) outer-loop over studios.slug='demo' explicitly (operator-
//       invoked) instead of relying on the implicit scope, or
//   (b) retire this endpoint in favour of Sprint A recurring-templates
//       work (v0.24.0), at which point demo classes are derived from
//       a per-studio template rather than rebased by cron.

/**
 * v0.9.5 Operational Baseline — demo class rebase.
 *
 * StudioFlow's six production-seeded classes were seeded with `now() +
 * interval` timestamps. A few days after seeding, every originally
 * "upcoming" class has aged into the past, the "live" class has ended,
 * and the operator / instructor flows become undemonstrable because
 * there is no class in the upcoming or live state to exercise.
 *
 * This endpoint re-anchors the six demo slugs to the exact same
 * relative offsets seed.sql originally used, so live always has:
 *
 *   reformer-mon-9   — completed (now - 7 days)
 *   yoga-tue-7       — completed (now - 6 days)
 *   spin-mon-1230    — live      (now - 20 min to now + 40 min)
 *   hiit-tue-1800    — upcoming  (now + 1 hour)
 *   barre-wed-10     — upcoming  (now + 1 day)
 *   reformer-thu-9   — upcoming  (now + 2 days)
 *
 * Idempotent — safe to call any number of times. Scoped strictly to the
 * six demo slugs below; production bookings are never touched. Other
 * classes (qa-* fixtures, anything seeded later) are untouched.
 *
 * Designed to be driven by a Vercel cron (see vercel.json) AND callable
 * manually from an operator surface. Both GET and POST are accepted
 * because Vercel cron uses GET and ad-hoc operator calls typically
 * use POST.
 */

// Demo slugs rebased by this endpoint. Keep in sync with supabase/seed.sql
// class inserts — any change there must be reflected here and vice versa.
const DEMO_CLASS_SLUGS = [
  "reformer-mon-9",
  "yoga-tue-7",
  "spin-mon-1230",
  "hiit-tue-1800",
  "barre-wed-10",
  "reformer-thu-9",
] as const;
type DemoClassSlug = (typeof DEMO_CLASS_SLUGS)[number];

type FailureCode =
  | "no_client"
  | "class_upsert"
  | "class_lookup";

function fail(code: FailureCode, message: string, status = 500) {
  return NextResponse.json(
    { ok: false, stage: code, error: message },
    { status },
  );
}

/**
 * Compose an ISO timestamp N minutes from `base`. Mirrors the helper in
 * /api/qa/refresh so both rebase flows use the same arithmetic.
 */
function addMinutes(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

/**
 * Compose an ISO timestamp for a class whose wall-clock start hour is
 * anchored to a specific local hour on a day offset from now(). Mirrors
 * seed.sql's `now() - interval '7 days' + time '09:00'` pattern so the
 * rebased classes keep their scheduled clock hours rather than drifting
 * by fractions of a day every rebase.
 *
 * dayOffset is signed: -7 means "7 days before today", +2 means "2 days
 * from today". hour/minute are the local (server TZ) start time.
 */
function atDayOffset(
  base: Date,
  dayOffset: number,
  hour: number,
  minute: number,
): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function handle() {
  const client = await scopedQuery();
  if (!client) {
    return fail(
      "no_client",
      "Supabase client is not configured. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from the server environment.",
      503,
    );
  }

  const now = new Date();

  // Six demo classes mirroring supabase/seed.sql, rebased to `now`.
  // check_in_window_minutes is deliberately omitted — it exists only
  // post-v0.8.4 migration and defaults to 15 on both schemas. Same rule
  // as /api/qa/refresh.
  type DemoClassRow = {
    slug: DemoClassSlug;
    title: string;
    instructor_name: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
    location_name: string;
    cancellation_window_hours: number;
  };

  const demoClasses: DemoClassRow[] = [
    // Completed classes — anchored to their seeded clock hours.
    {
      slug: "reformer-mon-9",
      title: "Reformer Pilates",
      instructor_name: "Sarah",
      starts_at: atDayOffset(now, -7, 9, 0),
      ends_at: atDayOffset(now, -7, 10, 0),
      capacity: 12,
      location_name: "Studio A",
      cancellation_window_hours: 24,
    },
    {
      slug: "yoga-tue-7",
      title: "Yoga Flow",
      instructor_name: "Aoife",
      starts_at: atDayOffset(now, -6, 7, 0),
      ends_at: atDayOffset(now, -6, 8, 0),
      capacity: 10,
      location_name: "Studio A",
      cancellation_window_hours: 24,
    },
    // Live — a rolling 60-minute window centred slightly after now().
    {
      slug: "spin-mon-1230",
      title: "Spin Express",
      instructor_name: "James",
      starts_at: addMinutes(now, -20),
      ends_at: addMinutes(now, 40),
      capacity: 16,
      location_name: "Studio B",
      cancellation_window_hours: 24,
    },
    // Upcoming — relative windows so the class never silently ages out.
    {
      slug: "hiit-tue-1800",
      title: "HIIT Circuit",
      instructor_name: "Mark",
      starts_at: addMinutes(now, 60),
      ends_at: addMinutes(now, 120),
      capacity: 10,
      location_name: "Studio B",
      // 2-hour cancellation window — seeded so the cutoff has already
      // passed once the class reaches +1h from now(). Preserves the
      // "cancellation window closed" visual the operator view uses.
      cancellation_window_hours: 2,
    },
    {
      slug: "barre-wed-10",
      title: "Barre Tone",
      instructor_name: "Sarah",
      starts_at: atDayOffset(now, 1, 10, 0),
      ends_at: atDayOffset(now, 1, 11, 0),
      capacity: 8,
      location_name: "Studio A",
      cancellation_window_hours: 24,
    },
    {
      slug: "reformer-thu-9",
      title: "Reformer Pilates",
      instructor_name: "Sarah",
      starts_at: atDayOffset(now, 2, 9, 0),
      ends_at: atDayOffset(now, 2, 10, 0),
      capacity: 12,
      location_name: "Studio A",
      cancellation_window_hours: 24,
    },
  ];

  // UPSERT by slug — self-healing. If a demo row was deleted it gets
  // recreated; if it exists its timestamps are refreshed. Bookings
  // attached via class_id are untouched — seed.sql's bookings and any
  // operator bookings made in between rebases survive intact.
  {
    const { error } = await client
      .from("classes")
      .upsert(demoClasses, { onConflict: "slug" });
    if (error) return fail("class_upsert", error.message);
  }

  // Verify all six slugs are present post-upsert so the response is
  // honest about what actually landed.
  const { data: classRows, error: classLookupErr } = await client
    .from("classes")
    .select("slug, starts_at, ends_at")
    .in("slug", DEMO_CLASS_SLUGS as readonly string[]);
  if (classLookupErr) return fail("class_lookup", classLookupErr.message);

  const byslug = new Map<string, { starts_at: string; ends_at: string }>();
  for (const r of classRows ?? []) {
    byslug.set(r.slug as string, {
      starts_at: r.starts_at as string,
      ends_at: r.ends_at as string,
    });
  }

  return NextResponse.json({
    ok: true,
    rebasedAt: now.toISOString(),
    classes: DEMO_CLASS_SLUGS.map((slug) => ({
      slug,
      starts_at: byslug.get(slug)?.starts_at ?? null,
      ends_at: byslug.get(slug)?.ends_at ?? null,
    })),
  });
}

export const GET = wrapRouteHandlerWithSentry(
  async function GET() {
  return handle();
},
  { method: "GET", parameterizedRoute: "/api/admin/rebase-demo-classes" },
);

export const POST = wrapRouteHandlerWithSentry(
  async function POST() {
  return handle();
},
  { method: "POST", parameterizedRoute: "/api/admin/rebase-demo-classes" },
);
