import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

import { withSentryCapture } from "@/lib/with-sentry";
/**
 * v0.15.1.1 GET-only purchase diagnostics.
 *
 * Safe to open in a browser. Read-only. No secrets exposed — the
 * stripe / webhook booleans report whether env vars are present,
 * not their values.
 *
 * v0.15.1 added on top of the v0.13.1 baseline:
 *   - sourceDistribution: row counts by source value, so the operator
 *     can see at a glance how many real Stripe purchases vs dev_fake
 *     vs operator_manual vs legacy 'fake' rows live in the table.
 *   - suspiciousFakeRows: rows with source='fake' on/after the
 *     v0.15.0 release point (2026-04-27). No current code path
 *     emits 'fake' once the migration is applied, so post-release
 *     'fake' rows are either an unmigrated DB falling back via
 *     applyPurchase or a direct write.
 *   - incompleteCompletedRows: rows with status='completed' but a
 *     NULL price_cents_paid OR credits_granted. Pre-v0.15.0 rows are
 *     legitimately NULL (no value to backfill); this counter scopes
 *     the flag to rows created after the v0.15.0 release point so
 *     legacy history isn't noisy.
 *   - flags[]: short human-readable strings summarising the above
 *     for paste-back into a release report.
 *
 * v0.15.1.1 added:
 *   - migrationApplied: detects whether the v0.15.0 schema is
 *     actually present (status / price_cents_paid / credits_granted
 *     columns + widened source CHECK). If missing, the endpoint
 *     degrades to the v0.13.1 shape (no v0.15.0 fields are queried)
 *     and surfaces a top-level flag pointing at the migration. This
 *     makes the missing-migration condition the single most visible
 *     thing on the page rather than a query error.
 *   - legacyFallback flag: when applyPurchase has been writing
 *     'fake' rows post-cutoff because the migration is missing,
 *     that's surfaced separately so it's not confused with a
 *     direct-DB-write anomaly.
 *
 * Intended use cases:
 *   - Confirming Stripe env is wired up on a deployment (or not).
 *   - Detecting an unmigrated DB silently writing legacy 'fake' rows.
 *   - Sanity-checking the last few purchases without diving into
 *     Supabase.
 *   - Post-merge QA for the purchase path.
 *
 * POST is deliberately NOT exported — diagnostics should never mutate.
 */

export const runtime = "nodejs";

/**
 * v0.15.0 went into main on 2026-04-27 (commit 4c6aa4f). After this
 * date, no code path emits source='fake' on a migrated DB. Anything
 * written with that source on/after this cutoff is a signal — either
 * an unmigrated DB (the v0.15.1.1 fallback path) or a direct DB
 * write. Conservative midnight-UTC of the commit day so a row created
 * the same day is included in the count.
 */
const V0150_RELEASE_CUTOFF_ISO = "2026-04-27T00:00:00Z";

type KnownSource = "stripe" | "fake" | "dev_fake" | "operator_manual";

type PurchaseSummaryRowLegacy = {
  id: string;
  memberSlug: string | null;
  memberName: string | null;
  planId: string;
  source: KnownSource;
  externalId: string;
  createdAt: string;
};

type PurchaseSummaryRow = PurchaseSummaryRowLegacy & {
  status: string;
  priceCentsPaid: number | null;
  creditsGranted: number | null;
};

type PurchaseJoinedRowLegacy = {
  id: string;
  plan_id: string;
  source: KnownSource;
  external_id: string;
  created_at: string;
  members: { slug: string | null; full_name: string | null } | null;
};

type PurchaseJoinedRow = PurchaseJoinedRowLegacy & {
  status: string;
  price_cents_paid: number | null;
  credits_granted: number | null;
};

function projectRowFull(r: PurchaseJoinedRow): PurchaseSummaryRow {
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

function projectRowLegacy(r: PurchaseJoinedRowLegacy): PurchaseSummaryRowLegacy {
  return {
    id: r.id,
    memberSlug: r.members?.slug ?? null,
    memberName: r.members?.full_name ?? null,
    planId: r.plan_id,
    source: r.source,
    externalId: r.external_id,
    createdAt: r.created_at,
  };
}

export const GET = withSentryCapture(
  async function GET() {
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const fakeModeActive = !stripeConfigured;

  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      {
        ok: false,
        stripeConfigured,
        webhookConfigured,
        fakeModeActive,
        error: "Supabase not configured",
      },
      { status: 503 },
    );
  }

  // Probe whether the v0.15.0 schema is applied. PostgREST evaluates
  // the SELECT column list against the schema when actually returning
  // rows; head:true skips that step, so we use a real LIMIT 1 select.
  // An empty result is fine — the test is whether the columns parse,
  // not whether any row exists. Postgres returns 42703 (undefined
  // column) if the migration is missing.
  const probe = await client
    .from("purchases")
    .select("id, status, price_cents_paid, credits_granted")
    .limit(1);
  const migrationApplied = !(probe.error && probe.error.code === "42703");
  const probeError =
    probe.error && probe.error.code !== "42703" ? probe.error.message : null;
  if (probeError) {
    return NextResponse.json(
      {
        ok: false,
        stripeConfigured,
        webhookConfigured,
        fakeModeActive,
        error: `migration probe failed: ${probeError}`,
      },
      { status: 500 },
    );
  }

  // Total purchase count.
  const { count: totalPurchases, error: countErr } = await client
    .from("purchases")
    .select("id", { count: "exact", head: true });
  if (countErr) {
    return NextResponse.json(
      {
        ok: false,
        stripeConfigured,
        webhookConfigured,
        fakeModeActive,
        migrationApplied,
        error: `purchases count query failed: ${countErr.message}`,
      },
      { status: 500 },
    );
  }

  // Source-distribution counts. One head:true count per known source
  // — four cheap queries. Unknown sources land in a bucket so a
  // future widening of the CHECK constraint stays visible.
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
      return NextResponse.json(
        {
          ok: false,
          stripeConfigured,
          webhookConfigured,
          fakeModeActive,
          migrationApplied,
          totalPurchases: totalPurchases ?? 0,
          error: `source distribution query failed: ${r.error}`,
        },
        { status: 500 },
      );
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

  const flags: string[] = [];

  // Migration-applied branch. Full v0.15.0 lifecycle queries.
  if (migrationApplied) {
    const fullCols =
      "id, plan_id, source, external_id, status, price_cents_paid, credits_granted, created_at, members(slug, full_name)";

    const { data: suspiciousFakeRowsRaw, count: suspiciousFakeCount, error: susErr } =
      await client
        .from("purchases")
        .select(fullCols, { count: "exact" })
        .eq("source", "fake")
        .gte("created_at", V0150_RELEASE_CUTOFF_ISO)
        .order("created_at", { ascending: false })
        .limit(10);
    if (susErr) {
      return NextResponse.json(
        {
          ok: false,
          stripeConfigured,
          webhookConfigured,
          fakeModeActive,
          migrationApplied,
          totalPurchases: totalPurchases ?? 0,
          sourceDistribution,
          error: `suspicious fake query failed: ${susErr.message}`,
        },
        { status: 500 },
      );
    }

    const { data: incompleteRowsRaw, count: incompleteCount, error: incErr } =
      await client
        .from("purchases")
        .select(fullCols, { count: "exact" })
        .eq("status", "completed")
        .gte("created_at", V0150_RELEASE_CUTOFF_ISO)
        .or("price_cents_paid.is.null,credits_granted.is.null")
        .order("created_at", { ascending: false })
        .limit(10);
    if (incErr) {
      return NextResponse.json(
        {
          ok: false,
          stripeConfigured,
          webhookConfigured,
          fakeModeActive,
          migrationApplied,
          totalPurchases: totalPurchases ?? 0,
          sourceDistribution,
          error: `incomplete-completed query failed: ${incErr.message}`,
        },
        { status: 500 },
      );
    }

    const { data: recent, error: recentErr } = await client
      .from("purchases")
      .select(fullCols)
      .order("created_at", { ascending: false })
      .limit(10);
    if (recentErr) {
      return NextResponse.json(
        {
          ok: false,
          stripeConfigured,
          webhookConfigured,
          fakeModeActive,
          migrationApplied,
          totalPurchases: totalPurchases ?? 0,
          sourceDistribution,
          error: `purchases recent query failed: ${recentErr.message}`,
        },
        { status: 500 },
      );
    }

    const suspiciousFakeRows: PurchaseSummaryRow[] = (
      (suspiciousFakeRowsRaw ?? []) as unknown as PurchaseJoinedRow[]
    ).map(projectRowFull);
    const incompleteCompletedRows: PurchaseSummaryRow[] = (
      (incompleteRowsRaw ?? []) as unknown as PurchaseJoinedRow[]
    ).map(projectRowFull);
    const last10Purchases: PurchaseSummaryRow[] = (
      (recent ?? []) as unknown as PurchaseJoinedRow[]
    ).map(projectRowFull);

    if ((suspiciousFakeCount ?? 0) > 0) {
      flags.push(
        `suspicious_fake_post_release: ${suspiciousFakeCount} row(s) with source='fake' created on or after ${V0150_RELEASE_CUTOFF_ISO} — no migrated code path emits 'fake' any more, so this points to a direct write (the migration IS applied here, so this is not a legacy-fallback case)`,
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
      migrationApplied: true,
      v0150ReleaseCutoff: V0150_RELEASE_CUTOFF_ISO,
      totalPurchases: totalPurchases ?? 0,
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

  // Migration-missing branch. Fall back to the v0.13.1 shape — no
  // v0.15.0 columns are queried — and surface the missing migration
  // as the headline flag.
  flags.push(
    "v0150_migration_missing: the purchases table is on the pre-v0.15.0 schema (no status / price_cents_paid / credits_granted columns and the source CHECK has not been widened). Apply supabase/v0.15.0_migration.sql to this Supabase project. Until then, applyPurchase falls back to legacy 'fake' source so purchases still complete (legacyFallbackUsed:true on the response) but lifecycle fields cannot be recorded.",
  );

  const legacyCols =
    "id, plan_id, source, external_id, created_at, members(slug, full_name)";
  const { data: recent, error: recentErr } = await client
    .from("purchases")
    .select(legacyCols)
    .order("created_at", { ascending: false })
    .limit(10);
  if (recentErr) {
    return NextResponse.json(
      {
        ok: false,
        stripeConfigured,
        webhookConfigured,
        fakeModeActive,
        migrationApplied: false,
        totalPurchases: totalPurchases ?? 0,
        sourceDistribution,
        flags,
        error: `purchases recent query failed: ${recentErr.message}`,
      },
      { status: 500 },
    );
  }

  const last10Purchases: PurchaseSummaryRowLegacy[] = (
    (recent ?? []) as unknown as PurchaseJoinedRowLegacy[]
  ).map(projectRowLegacy);

  if (sourceDistribution.fake_legacy > 0) {
    flags.push(
      `legacy_fallback_in_effect: ${sourceDistribution.fake_legacy} purchase row(s) carry source='fake'. On the unmigrated schema this is the only available source value for non-Stripe purchases, so each new dev_fake or operator_manual purchase is being written as 'fake'. After applying the migration, retry source distribution will flip to the canonical buckets.`,
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
    migrationApplied: false,
    v0150ReleaseCutoff: V0150_RELEASE_CUTOFF_ISO,
    totalPurchases: totalPurchases ?? 0,
    sourceDistribution,
    last10Purchases,
    flags,
    note:
      "v0.15.0 migration is NOT applied on this Supabase. Run " +
      "supabase/v0.15.0_migration.sql to enable the lifecycle " +
      "diagnostics. Diagnostics only — read-only. The three purchase " +
      "endpoints (/api/stripe/create-checkout-session, " +
      "/api/stripe/webhook, /api/dev/fake-purchase) are POST-only " +
      "and MUST NOT be opened as browser QA URLs; they return " +
      "HTTP 405 on GET.",
  });
},
  { method: "GET", parameterizedRoute: "/api/admin/purchase-health" },
);
