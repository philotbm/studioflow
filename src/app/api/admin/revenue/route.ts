import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.17.0 GET-only revenue summary.
 *
 * Read-only aggregation over the `purchases` table — no Stripe call,
 * no member lookup, no plan lookup. Powers the operator
 * /app/revenue page.
 *
 * Eligibility filter (every aggregation below applies all three):
 *   - status IN ('completed','refunded')
 *   - price_cents_paid IS NOT NULL
 *   - credits_granted IS NOT NULL
 *
 * Excluded:
 *   - Pre-v0.15.0 legacy rows (NULL price). These are counted
 *     separately as `legacyExcludedCount` so the operator can see
 *     how much of the table is invisible to revenue accounting.
 *   - Future failed/cancelled rows (no producer writes them today).
 *   - Unlimited-plan rows (NULL credits_granted) — none exist on
 *     prod yet but the filter is intentional per the v0.17.0 brief.
 *     Will need a separate revenue model when unlimited plans
 *     start moving money.
 *
 * Computed totals:
 *   - grossRevenueCents       = SUM(price_cents_paid) over all
 *                               eligible rows (completed + refunded).
 *                               Standard accounting: "total billed".
 *   - refundedRevenueCents    = SUM(price_cents_paid) over eligible
 *                               status='refunded' rows.
 *   - netRevenueCents         = gross - refunded
 *                             = SUM over eligible status='completed'.
 *   - completedCount          = COUNT eligible status='completed'.
 *   - refundedCount           = COUNT eligible status='refunded'.
 *   - legacyExcludedCount     = COUNT WHERE price_cents_paid IS NULL.
 *   - bySource[]              = per-source breakdown (count + revenue
 *                               for completed and refunded plus net),
 *                               sorted by revenueCompletedCents desc.
 *
 * Brief-text vs intent note: the v0.17.0 brief's literal text for
 * "gross revenue" reads "SUM WHERE status='completed'", which would
 * make gross < net once any refund exists. The brief's own validation
 * numbers (gross €150 vs net €50 with one refund) require the
 * standard-accounting interpretation used here. This route follows
 * the standard one.
 *
 * GET-safe and read-only. POST is deliberately not exported.
 */

export const runtime = "nodejs";

type KnownSource = "stripe" | "fake" | "dev_fake" | "operator_manual";
type PurchaseStatus = "completed" | "failed" | "refunded" | "cancelled";

type PurchaseRow = {
  status: PurchaseStatus;
  source: KnownSource | string;
  price_cents_paid: number | null;
  credits_granted: number | null;
};

export type SourceRevenue = {
  source: string;
  countCompleted: number;
  revenueCompletedCents: number;
  countRefunded: number;
  revenueRefundedCents: number;
  netRevenueCents: number;
};

export type RevenueSummary = {
  ok: true;
  grossRevenueCents: number;
  refundedRevenueCents: number;
  netRevenueCents: number;
  completedCount: number;
  refundedCount: number;
  legacyExcludedCount: number;
  bySource: SourceRevenue[];
  /** Total `purchases` rows on the table — sanity check vs. the
   *  eligibility filter so the operator can see what fraction of
   *  the table is contributing to the numbers. */
  totalRows: number;
};

export async function GET() {
  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const { data, error } = await client
    .from("purchases")
    .select("status, source, price_cents_paid, credits_granted");
  if (error) {
    // 42703 (undefined column) means the v0.15.0 migration hasn't
    // been applied. Return a clear, GET-safe error rather than
    // leaking the postgres code.
    if (error.code === "42703") {
      return NextResponse.json(
        {
          ok: false,
          code: "schema_missing",
          error:
            "purchases table is missing v0.15.0 lifecycle columns. " +
            "Apply supabase/v0.15.0_migration.sql.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `purchases query failed: ${error.message}` },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as PurchaseRow[];

  let grossRevenueCents = 0;
  let refundedRevenueCents = 0;
  let completedCount = 0;
  let refundedCount = 0;
  let legacyExcludedCount = 0;

  // Per-source aggregation. Map keyed on source value; we only
  // surface sources that have at least one eligible row, so a
  // source with zero rows (e.g. stripe today) doesn't clutter the
  // table.
  const sourceMap = new Map<string, SourceRevenue>();
  function bucket(source: string): SourceRevenue {
    let s = sourceMap.get(source);
    if (!s) {
      s = {
        source,
        countCompleted: 0,
        revenueCompletedCents: 0,
        countRefunded: 0,
        revenueRefundedCents: 0,
        netRevenueCents: 0,
      };
      sourceMap.set(source, s);
    }
    return s;
  }

  for (const r of rows) {
    if (r.price_cents_paid === null) {
      legacyExcludedCount += 1;
      continue;
    }
    if (r.credits_granted === null) {
      // Unlimited (or otherwise non-credit) purchase. Out of scope
      // for v0.17.0 revenue per the brief. Counted as legacy-style
      // exclusion so the totals reconcile.
      legacyExcludedCount += 1;
      continue;
    }
    if (r.status !== "completed" && r.status !== "refunded") {
      // failed/cancelled — schema-allowed but no current emitter.
      continue;
    }

    const s = bucket(r.source);
    if (r.status === "completed") {
      completedCount += 1;
      grossRevenueCents += r.price_cents_paid;
      s.countCompleted += 1;
      s.revenueCompletedCents += r.price_cents_paid;
    } else {
      refundedCount += 1;
      grossRevenueCents += r.price_cents_paid;
      refundedRevenueCents += r.price_cents_paid;
      s.countRefunded += 1;
      s.revenueRefundedCents += r.price_cents_paid;
    }
  }

  // Per-source net = completed revenue - refunded revenue. Note
  // this can go negative for a source if every completed purchase
  // for it has been refunded plus then some. That's fine — the
  // table shows the truth.
  for (const s of sourceMap.values()) {
    s.netRevenueCents = s.revenueCompletedCents - s.revenueRefundedCents;
  }

  // Sort by revenueCompletedCents descending. Ties broken by
  // refunded-revenue desc, then source name for determinism.
  const bySource = Array.from(sourceMap.values()).sort((a, b) => {
    if (b.revenueCompletedCents !== a.revenueCompletedCents) {
      return b.revenueCompletedCents - a.revenueCompletedCents;
    }
    if (b.revenueRefundedCents !== a.revenueRefundedCents) {
      return b.revenueRefundedCents - a.revenueRefundedCents;
    }
    return a.source.localeCompare(b.source);
  });

  const summary: RevenueSummary = {
    ok: true,
    grossRevenueCents,
    refundedRevenueCents,
    netRevenueCents: grossRevenueCents - refundedRevenueCents,
    completedCount,
    refundedCount,
    legacyExcludedCount,
    bySource,
    totalRows: rows.length,
  };
  return NextResponse.json(summary);
}
