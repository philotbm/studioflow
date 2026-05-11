import { scopedQuery } from "@/lib/db";

/**
 * v0.17.2 shared revenue module.
 *
 * Single source of truth for revenue range parsing, window
 * computation, eligibility filtering, and aggregation. Consumed by:
 *   - /api/admin/revenue        (JSON summary)
 *   - /api/admin/revenue/export (CSV export of the same numbers)
 *
 * Extracting this from the route handlers keeps the two endpoints
 * provably consistent — they share the same helpers, the same
 * eligibility filter, the same aggregation pass. A future test
 * harness can exercise `aggregatePurchases` directly without
 * touching Supabase.
 *
 * Eligibility filter (every aggregation applies all three):
 *   - status IN ('completed','refunded')
 *   - price_cents_paid IS NOT NULL
 *   - credits_granted  IS NOT NULL
 *
 * Excluded from revenue but counted as `legacyExcludedCount`:
 *   - Pre-v0.15.0 legacy rows (NULL price)
 *   - Unlimited rows (NULL credits_granted)
 */

export type RangeKey = "lifetime" | "today" | "last7" | "last30";

export const ALLOWED_RANGES: ReadonlyArray<RangeKey> = [
  "lifetime",
  "today",
  "last7",
  "last30",
];

export const RANGE_LABELS: Record<RangeKey, string> = {
  lifetime: "All time",
  today: "Today (Europe/Dublin)",
  last7: "Last 7 days",
  last30: "Last 30 days",
};

/**
 * Operator-friendly labels for `purchases.source` values. Shared
 * between /app/revenue (the page) and /api/admin/revenue/export
 * (the CSV) so both surfaces speak the same source vocabulary.
 * Mirrors PURCHASE_SOURCE_LABELS in member-detail.tsx.
 */
export const SOURCE_DISPLAY_LABELS: Record<string, string> = {
  stripe: "Stripe",
  dev_fake: "Test purchase (no Stripe)",
  operator_manual: "Operator test purchase",
  fake: "Test purchase (legacy)",
};

export function sourceDisplayLabel(s: string): string {
  return SOURCE_DISPLAY_LABELS[s] ?? s;
}

export type ParsedRange =
  | { ok: true; range: RangeKey }
  | { ok: false; error: string };

/** Parses a `?range=` query value. `null` → defaults to lifetime. */
export function parseRange(input: string | null): ParsedRange {
  if (input === null) return { ok: true, range: "lifetime" };
  if ((ALLOWED_RANGES as readonly string[]).includes(input)) {
    return { ok: true, range: input as RangeKey };
  }
  return {
    ok: false,
    error: `Invalid range "${input}". Must be one of: ${ALLOWED_RANGES.join(", ")}.`,
  };
}

/**
 * Compute "start of today" in Europe/Dublin as a UTC instant.
 * Uses Intl date math so DST transitions (BST ↔ IST) are handled by
 * the Node.js runtime tz database; no hardcoded offsets.
 */
export function startOfTodayDublin(now: Date): Date {
  const tz = "Europe/Dublin";
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tzNamePart = new Intl.DateTimeFormat("en", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName");
  const offsetHours = (() => {
    if (!tzNamePart) return 0;
    const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(tzNamePart.value);
    if (!m) return 0;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    return h + (h < 0 ? -mins : mins) / 60;
  })();
  const utcMidnightOfYmd = new Date(`${ymd}T00:00:00Z`).getTime();
  return new Date(utcMidnightOfYmd - offsetHours * 60 * 60 * 1000);
}

export function rangeWindow(
  range: RangeKey,
  now: Date,
): { start: Date | null; end: Date | null } {
  if (range === "lifetime") return { start: null, end: null };
  if (range === "today") return { start: startOfTodayDublin(now), end: now };
  if (range === "last7") {
    return {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now,
    };
  }
  return {
    start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    end: now,
  };
}

function inWindow(
  createdAt: string,
  start: Date | null,
  end: Date | null,
): boolean {
  if (start === null && end === null) return true;
  const t = new Date(createdAt).getTime();
  if (start !== null && t < start.getTime()) return false;
  if (end !== null && t > end.getTime()) return false;
  return true;
}

type KnownSource = "stripe" | "fake" | "dev_fake" | "operator_manual";
type PurchaseStatus = "completed" | "failed" | "refunded" | "cancelled";

export type PurchaseRow = {
  status: PurchaseStatus;
  source: KnownSource | string;
  price_cents_paid: number | null;
  credits_granted: number | null;
  created_at: string;
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
  selectedRange: RangeKey;
  rangeLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  grossRevenueCents: number;
  refundedRevenueCents: number;
  netRevenueCents: number;
  completedCount: number;
  refundedCount: number;
  legacyExcludedCount: number;
  bySource: SourceRevenue[];
  totalRows: number;
};

/**
 * Pure aggregation. No Supabase, no IO — easy to unit-test.
 * `now` is a parameter so tests can pin time.
 */
export function aggregatePurchases(
  allRows: PurchaseRow[],
  range: RangeKey,
  now: Date = new Date(),
): RevenueSummary {
  const { start, end } = rangeWindow(range, now);
  const rows = allRows.filter((r) => inWindow(r.created_at, start, end));

  let grossRevenueCents = 0;
  let refundedRevenueCents = 0;
  let completedCount = 0;
  let refundedCount = 0;
  let legacyExcludedCount = 0;

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
      legacyExcludedCount += 1;
      continue;
    }
    if (r.status !== "completed" && r.status !== "refunded") {
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

  for (const s of sourceMap.values()) {
    s.netRevenueCents = s.revenueCompletedCents - s.revenueRefundedCents;
  }

  const bySource = Array.from(sourceMap.values()).sort((a, b) => {
    if (b.revenueCompletedCents !== a.revenueCompletedCents) {
      return b.revenueCompletedCents - a.revenueCompletedCents;
    }
    if (b.revenueRefundedCents !== a.revenueRefundedCents) {
      return b.revenueRefundedCents - a.revenueRefundedCents;
    }
    return a.source.localeCompare(b.source);
  });

  return {
    ok: true,
    selectedRange: range,
    rangeLabel: RANGE_LABELS[range],
    rangeStart: start ? start.toISOString() : null,
    rangeEnd: end ? end.toISOString() : null,
    grossRevenueCents,
    refundedRevenueCents,
    netRevenueCents: grossRevenueCents - refundedRevenueCents,
    completedCount,
    refundedCount,
    legacyExcludedCount,
    bySource,
    totalRows: rows.length,
  };
}

export type FetchRevenueResult =
  | { ok: true; summary: RevenueSummary }
  | { ok: false; status: number; code?: string; error: string };

/**
 * Wraps the Supabase fetch + aggregation in one call. Routes that
 * need either JSON or CSV both land here, so they aggregate from
 * exactly the same rows under exactly the same `now`.
 */
export async function fetchRevenue(
  range: RangeKey,
  now: Date = new Date(),
): Promise<FetchRevenueResult> {
  const client = await scopedQuery();
  if (!client) {
    return {
      ok: false,
      status: 503,
      error: "Supabase not configured",
    };
  }

  const { data, error } = await client
    .from("purchases")
    .select("status, source, price_cents_paid, credits_granted, created_at");
  if (error) {
    if (error.code === "42703") {
      return {
        ok: false,
        status: 500,
        code: "schema_missing",
        error:
          "purchases table is missing v0.15.0 lifecycle columns. " +
          "Apply supabase/v0.15.0_migration.sql.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: `purchases query failed: ${error.message}`,
    };
  }

  const summary = aggregatePurchases((data ?? []) as PurchaseRow[], range, now);
  return { ok: true, summary };
}
