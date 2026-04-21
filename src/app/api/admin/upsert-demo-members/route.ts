import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.12.1 No-Entitlement Member Fix.
 *
 * Idempotent upsert of a curated demo member roster for members that
 * aren't guaranteed to exist on every environment. Scoped strictly to
 * slugs listed below — production members outside this list are never
 * touched.
 *
 * Background: supabase/seed.sql ships mairead-kinsella as the
 * zero-credit / no-entitlement demo case, but the original production
 * seed was applied before that row was added. The seed file itself
 * carries a comment saying "only materialises in environments where
 * seed.sql is actually applied". That left /my/mairead-kinsella
 * returning "We couldn't find that member" on live, because
 * fetchAllMembers reads v_members_with_access and the row didn't
 * exist there.
 *
 * This endpoint upserts the missing demo row (and any other demo
 * members added here in the future) so live always has the commerce-
 * entry proof case available. Call it once after deploy; it is
 * idempotent and safe to re-run. No Vercel cron — member data doesn't
 * decay like class timestamps do, so one-shot is enough.
 *
 * Non-targets:
 *   - QA fixture members (qa-*) are managed by /api/qa/refresh.
 *   - Production-seeded demo members (emma-kelly, ciara-byrne, etc.)
 *     are already live and deliberately not touched here — we don't
 *     want to clobber any manual credit adjustments the operator has
 *     made on them.
 */

type FailureCode = "no_client" | "member_upsert" | "member_lookup";

function fail(code: FailureCode, message: string, status = 500) {
  return NextResponse.json(
    { ok: false, stage: code, error: message },
    { status },
  );
}

// ── Demo members to materialise ────────────────────────────────────
// Today: just mairead-kinsella. Add more rows here if any future
// seed.sql addition needs to land on live without re-seeding.
const DEMO_MEMBER_SLUGS = ["mairead-kinsella"] as const;

const MAIREAD_INSIGHTS = {
  totalAttended: 5,
  lateCancels: 0,
  noShows: 0,
  cancellationRate: "0%",
  avgHoldBeforeCancel: "N/A",
  preCutoffCancels: 0,
  postCutoffCancels: 0,
  behaviourScore: 98,
  behaviourLabel: "Strong",
  classMix: [
    { label: "Yoga Flow", count: 3 },
    { label: "Barre Tone", count: 2 },
  ],
};

const MAIREAD_PURCHASE_INSIGHTS = {
  activePlan: {
    type: "credit_pack",
    product: "5-Class Pass",
    purchaseDate: "20 Mar",
    totalCredits: 5,
    creditsUsed: 5,
    creditsRemaining: 0,
    lastUsedDate: "7 Apr",
    purchaseStatus: "Consumed",
    usageLog: [],
  },
  previousPurchases: [],
  buyerPattern: "Reliable pack user — pack fully consumed",
};

const MAIREAD_OPPORTUNITY_SIGNALS = [
  {
    label: "Likely to repurchase",
    detail:
      "Strong attendance, just drained her pack — prime moment to sell another",
    tone: "positive",
  },
];

const MAIREAD_HISTORY = [
  { date: "7 Apr", event: "Yoga Flow — Mon 07:00", type: "attended" },
  { date: "20 Mar", event: "Purchased 5-Class Pass", type: "purchase" },
];

async function handle() {
  const client = getSupabaseClient();
  if (!client) {
    return fail(
      "no_client",
      "Supabase client is not configured. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from the server environment.",
      503,
    );
  }

  // Upsert by slug. members.slug has a unique constraint so this
  // converges on the documented demo state without caring whether the
  // row existed before.
  const { error: upsertErr } = await client.from("members").upsert(
    [
      {
        slug: "mairead-kinsella",
        full_name: "Mairead Kinsella",
        status: "active",
        plan_type: "class_pack",
        plan_name: "5-Class Pass",
        credits_remaining: 0,
        insights_json: MAIREAD_INSIGHTS,
        purchase_insights_json: MAIREAD_PURCHASE_INSIGHTS,
        opportunity_signals_json: MAIREAD_OPPORTUNITY_SIGNALS,
        history_summary_json: MAIREAD_HISTORY,
      },
    ],
    { onConflict: "slug" },
  );
  if (upsertErr) return fail("member_upsert", upsertErr.message);

  // Confirm the rows ended up in the DB and report their resolved IDs.
  const { data: rows, error: lookupErr } = await client
    .from("members")
    .select("id, slug, full_name, status, plan_type, credits_remaining")
    .in("slug", DEMO_MEMBER_SLUGS as readonly string[]);
  if (lookupErr) return fail("member_lookup", lookupErr.message);

  return NextResponse.json({
    ok: true,
    upsertedAt: new Date().toISOString(),
    members: rows ?? [],
  });
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
