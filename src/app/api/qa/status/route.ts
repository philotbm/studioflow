import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { scopedQuery } from "@/lib/db";

/**
 * v0.8.4.2 QA environment status endpoint.
 *
 * Tells the /qa landing page (and anyone else) whether the QA fixture
 * environment is operational, without writing anything. Returns:
 *
 *   ready: boolean       — true when every expected fixture row is present
 *   missingClasses[]     — qa-* slugs that aren't yet in the classes table
 *   missingMembers[]     — qa-* slugs that aren't yet in the members table
 *   fixtureCount         — how many bookings exist across the fixture set
 *   reason               — present when ready=false, describes the gap
 *
 * A false readiness does NOT mean an error — it just means the tester
 * should hit /api/qa/refresh (or visit /qa which does that on mount)
 * to self-activate the fixtures.
 */

// v0.9.0: qa-drained (class_pack, 0 credits) added for the no_credits
// eligibility QA path. v0.9.0.1: qa-cancel-test member and qa-future
// class added for the book→cancel credit trace. Must stay in sync
// with /api/qa/refresh.
const QA_MEMBER_SLUGS = [
  "qa-alex",
  "qa-blake",
  "qa-casey",
  "qa-drained",
  "qa-cancel-test",
] as const;
const QA_CLASS_SLUGS = [
  "qa-too-early",
  "qa-open",
  "qa-already-in",
  "qa-closed",
  "qa-correction",
  "qa-future",
] as const;

export async function GET(req: NextRequest) {
  // v0.23.1 verification harness — REMOVED in v0.23.2 cleanup.
  // Explicit captureException + flush mirroring the v0.22.4 pattern.
  // Parallel surface to the /api/health harness; this one verifies
  // the supabase.ts side-effect chain (the "real" production
  // entry-point pattern) once Phil signs in on prod.
  if (req.nextUrl.searchParams.get("throw") === "1") {
    const err = new Error("Sentry shared-init smoke — deliberate throw from /api/qa/status");
    Sentry.captureException(err);
    await Sentry.flush(2000);
    throw err;
  }
  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      {
        ready: false,
        reason: "supabase_not_configured",
        message:
          "Supabase client is not configured in the server environment.",
        missingClasses: [...QA_CLASS_SLUGS],
        missingMembers: [...QA_MEMBER_SLUGS],
        fixtureCount: 0,
      },
      { status: 503 },
    );
  }

  const [classesRes, membersRes] = await Promise.all([
    client.from("classes").select("slug").in("slug", QA_CLASS_SLUGS as readonly string[]),
    client.from("members").select("slug").in("slug", QA_MEMBER_SLUGS as readonly string[]),
  ]);

  if (classesRes.error) {
    return NextResponse.json(
      {
        ready: false,
        reason: "classes_query_failed",
        message: classesRes.error.message,
      },
      { status: 500 },
    );
  }
  if (membersRes.error) {
    return NextResponse.json(
      {
        ready: false,
        reason: "members_query_failed",
        message: membersRes.error.message,
      },
      { status: 500 },
    );
  }

  const presentClassSlugs = new Set(
    (classesRes.data ?? []).map((r) => r.slug as string),
  );
  const presentMemberSlugs = new Set(
    (membersRes.data ?? []).map((r) => r.slug as string),
  );
  const missingClasses = QA_CLASS_SLUGS.filter(
    (s) => !presentClassSlugs.has(s),
  );
  const missingMembers = QA_MEMBER_SLUGS.filter(
    (s) => !presentMemberSlugs.has(s),
  );

  // Count bookings across the fixture set as a sanity signal.
  let fixtureCount = 0;
  if (missingClasses.length === 0) {
    const { data: classIds } = await client
      .from("classes")
      .select("id")
      .in("slug", QA_CLASS_SLUGS as readonly string[]);
    const ids = (classIds ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      const { count } = await client
        .from("class_bookings")
        .select("id", { count: "exact", head: true })
        .in("class_id", ids);
      fixtureCount = count ?? 0;
    }
  }

  const ready = missingClasses.length === 0 && missingMembers.length === 0;
  const reason = ready
    ? undefined
    : missingClasses.length > 0 && missingMembers.length > 0
      ? "fixtures_missing"
      : missingClasses.length > 0
        ? "classes_missing"
        : "members_missing";

  return NextResponse.json({
    ready,
    reason,
    missingClasses,
    missingMembers,
    fixtureCount,
  });
}
