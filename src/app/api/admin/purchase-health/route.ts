import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.15.1 GET-only purchase diagnostics.
 *
 * Safe to open in a browser. Read-only. No secrets exposed — the
 * stripe / webhook booleans report whether env vars are present,
 * not their values.
 *
 * v0.15.1 additions on top of the v0.13.1 baseline:
 *   - sourceDistribution: row counts by source value, so the operator
 *     can see at a glance how many real Stripe purchases vs dev_fake
 *     vs operator_manual vs legacy 'fake' rows live in the table.
 *   - suspiciousFakeRows: any row with source='fake' created on or
 *     after the v0.15.0 release point (2026-04-27). No current code
 *     path emits 'fake' any more, so post-release 'fake' rows are
 *     either an unmigrated DB silently writing legacy values (the
 *     pre-v0.15.1 behaviour we removed) or direct DB writes. Flagged
 *     loudly so a missed migration is visible.
 *   - incompleteCompletedRows: rows with status='completed' but a
 *     NULL price_cents_paid OR credits_granted. Pre-v0.15.0 rows are
 *     legitimately NULL (no value to backfill); this counter scopes
 *     the flag to rows created after the v0.15.0 release point so
 *     legacy history isn't noisy.
 *   - flags[]: short human-readable strings summarising the above for
 *     paste-back into a release report.
 *
 * Intended use cases:
 *   - Confirming Stripe env is wired up on a deployment (or not).
 *   - Sanity-checking the last few purchases without diving into
 *     Supabase.
 *   - Post-merge QA for the purchase path.
 *   - Detecting an unmigrated DB silently writing legacy 'fake' rows.
 *
 * POST is deliberately NOT exported — diagnostics should never mutate.
 */

export const runtime = "nodejs";

/**
 * v0.15.0 went into main on 2026-04-27 (commit 4c6aa4f). After this
 * date, no code path emits source='fake'. Anything written with that
 * source on/after this cutoff is a signal — either an unmigrated DB
 * (the v0.15.0 silent fallback we removed in v0.15.1) or a direct
 * DB write. Conservative midnight-UTC of the commit day so a row
 * created the same day is included in the count.
 */
const V0150_RELEASE_CUTOFF_ISO = "2026-04-27T00:00:00Z";

type KnownSource = "stripe" | "fake" | "dev_fake" | "operator_manual";

type PurchaseSummaryRow = {
  id: string;
  memberSlug: string | null;
  memberName: string | null;
  planId: string;
  source: KnownSource;
  externalId: string;
  status: string;
  priceCentsPaid: number | null;
  creditsGranted: number | null;
  createdAt: string;
};

export async function GET() {
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const fakeModeActive = !stripeConfigured;

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      error: "Supabase not configured",
    }, { status: 503 });
  }

  // Total purchase count.
  const { count: totalPurchases, error: countErr } = await client
    .from("purchases")
    .select("id", { count: "exact", head: true });
  if (countErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      error: `purchases count query failed: ${countErr.message}`,
    }, { status: 500 });
  }

  // Source-distribution counts. One head:true count per known source —
  // four cheap queries, no row payload returned. Unknown sources land
  // in a single `unknown` bucket so a future widening of the CHECK
  // constraint is visible without a code change.
  async function countBySource(
    source: KnownSource,
  ): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
    const { count, error } = await client!
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("source", source);
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: count ?? 0 };
  }

  const [stripeCount, fakeCount, devFakeCount, operatorManualCount] =
    await Promise.all([
      countBySource("stripe"),
      countBySource("fake"),
      countBySource("dev_fake"),
      countBySource("operator_manual"),
    ]);

  for (const r of [stripeCount, fakeCount, devFakeCount, operatorManualCount]) {
    if (!r.ok) {
      return NextResponse.json({
        ok: false,
        stripeConfigured,
        webhookConfigured,
        fakeModeActive,
        totalPurchases: totalPurchases ?? 0,
        error: `source distribution query failed: ${r.error}`,
      }, { status: 500 });
    }
  }

  const knownTotal =
    (stripeCount.ok ? stripeCount.count : 0) +
    (fakeCount.ok ? fakeCount.count : 0) +
    (devFakeCount.ok ? devFakeCount.count : 0) +
    (operatorManualCount.ok ? operatorManualCount.count : 0);
  const sourceDistribution = {
    stripe: stripeCount.ok ? stripeCount.count : 0,
    dev_fake: devFakeCount.ok ? devFakeCount.count : 0,
    operator_manual: operatorManualCount.ok ? operatorManualCount.count : 0,
    fake_legacy: fakeCount.ok ? fakeCount.count : 0,
    unknown: Math.max(0, (totalPurchases ?? 0) - knownTotal),
  };

  // Suspicious 'fake' rows: source='fake' AND created_at >= cutoff.
  const { data: suspiciousFakeRowsRaw, count: suspiciousFakeCount, error: susErr } =
    await client
      .from("purchases")
      .select(
        "id, plan_id, source, external_id, status, price_cents_paid, credits_granted, created_at, members(slug, full_name)",
        { count: "exact" },
      )
      .eq("source", "fake")
      .gte("created_at", V0150_RELEASE_CUTOFF_ISO)
      .order("created_at", { ascending: false })
      .limit(10);
  if (susErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      totalPurchases: totalPurchases ?? 0,
      sourceDistribution,
      error: `suspicious fake query failed: ${susErr.message}`,
    }, { status: 500 });
  }

  // Incomplete completed rows: status='completed' AND created_at >= cutoff
  // AND (price_cents_paid IS NULL OR credits_granted IS NULL). Scoped to
  // post-cutoff rows so legacy NULLs (legitimate, no value to backfill)
  // do not light up the diagnostic forever.
  const { data: incompleteRowsRaw, count: incompleteCount, error: incErr } =
    await client
      .from("purchases")
      .select(
        "id, plan_id, source, external_id, status, price_cents_paid, credits_granted, created_at, members(slug, full_name)",
        { count: "exact" },
      )
      .eq("status", "completed")
      .gte("created_at", V0150_RELEASE_CUTOFF_ISO)
      .or("price_cents_paid.is.null,credits_granted.is.null")
      .order("created_at", { ascending: false })
      .limit(10);
  if (incErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      totalPurchases: totalPurchases ?? 0,
      sourceDistribution,
      error: `incomplete-completed query failed: ${incErr.message}`,
    }, { status: 500 });
  }

  type PurchaseJoinedRow = {
    id: string;
    plan_id: string;
    source: KnownSource;
    external_id: string;
    status: string;
    price_cents_paid: number | null;
    credits_granted: number | null;
    created_at: string;
    members: { slug: string | null; full_name: string | null } | null;
  };

  function projectRow(r: PurchaseJoinedRow): PurchaseSummaryRow {
    return {
      id: r.id,
      memberSlug: r.members?.slug ?? null,
      memberName: r.members?.full_name ?? null,
      planId: r.plan_id,
      source: r.source,
      externalId: r.external_id,
      status: r.status,
      priceCentsPaid: r.price_cents_paid,
      creditsGranted: r.credits_granted,
      createdAt: r.created_at,
    };
  }

  const suspiciousFakeRows: PurchaseSummaryRow[] = (
    (suspiciousFakeRowsRaw ?? []) as unknown as PurchaseJoinedRow[]
  ).map(projectRow);

  const incompleteCompletedRows: PurchaseSummaryRow[] = (
    (incompleteRowsRaw ?? []) as unknown as PurchaseJoinedRow[]
  ).map(projectRow);

  // Last 10 across all sources — same shape as v0.13.1 so existing QA
  // notes still work.
  const { data: recent, error: recentErr } = await client
    .from("purchases")
    .select(
      "id, plan_id, source, external_id, status, price_cents_paid, credits_granted, created_at, members(slug, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(10);
  if (recentErr) {
    return NextResponse.json({
      ok: false,
      stripeConfigured,
      webhookConfigured,
      fakeModeActive,
      totalPurchases: totalPurchases ?? 0,
      sourceDistribution,
      error: `purchases recent query failed: ${recentErr.message}`,
    }, { status: 500 });
  }

  const last10Purchases: PurchaseSummaryRow[] = (
    (recent ?? []) as unknown as PurchaseJoinedRow[]
  ).map(projectRow);

  const flags: string[] = [];
  if ((suspiciousFakeCount ?? 0) > 0) {
    flags.push(
      `suspicious_fake_post_release: ${suspiciousFakeCount} row(s) with source='fake' created on or after ${V0150_RELEASE_CUTOFF_ISO} — no code path emits 'fake' any more, so this points to an unmigrated DB or a direct write`,
    );
  }
  if ((incompleteCount ?? 0) > 0) {
    flags.push(
      `incomplete_completed_rows: ${incompleteCount} row(s) with status='completed' but NULL price_cents_paid or credits_granted, created on or after ${V0150_RELEASE_CUTOFF_ISO} — lifecycle enrichment UPDATE failed silently for these rows`,
    );
  }
  if (sourceDistribution.unknown > 0) {
    flags.push(
      `unknown_source_rows: ${sourceDistribution.unknown} row(s) with a source value outside the known set (stripe/dev_fake/operator_manual/fake)`,
    );
  }

  return NextResponse.json({
    ok: true,
    stripeConfigured,
    webhookConfigured,
    fakeModeActive,
    totalPurchases: totalPurchases ?? 0,
    v0150ReleaseCutoff: V0150_RELEASE_CUTOFF_ISO,
    sourceDistribution,
    suspiciousFakePostReleaseCount: suspiciousFakeCount ?? 0,
    suspiciousFakeRows,
    incompleteCompletedCount: incompleteCount ?? 0,
    incompleteCompletedRows,
    last10Purchases,
    flags,
    note:
      "Diagnostics only — read-only. The three purchase endpoints " +
      "(/api/stripe/create-checkout-session, /api/stripe/webhook, " +
      "/api/dev/fake-purchase) are POST-only and MUST NOT be opened " +
      "as browser QA URLs; they return HTTP 405 on GET.",
  });
}
