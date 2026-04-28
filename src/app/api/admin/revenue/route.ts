import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.17.1 GET-only revenue summary with optional date range filter.
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
 *
 * Computed totals (within the selected date range, if any):
 *   - grossRevenueCents       = SUM(price_cents_paid) over all
 *                               eligible rows (completed + refunded).
 *                               Standard accounting: "total billed".
 *   - refundedRevenueCents    = SUM(price_cents_paid) over eligible
 *                               status='refunded' rows.
 *   - netRevenueCents         = gross - refunded.
 *   - completedCount          = COUNT eligible status='completed'.
 *   - refundedCount           = COUNT eligible status='refunded'.
 *   - legacyExcludedCount     = COUNT WHERE price_cents_paid IS NULL
 *                               OR credits_granted IS NULL (within range).
 *   - bySource[]              = per-source breakdown sorted by
 *                               revenueCompletedCents desc.
 *
 * v0.17.1 date-range filter (NEW):
 *   ?range=lifetime|today|last7|last30  (default: lifetime)
 *
 *   - lifetime — no created_at filter.
 *   - today    — created_at >= start of today in Europe/Dublin (the
 *                studio's timezone). The cutoff is computed via
 *                Intl date math so it tracks DST correctly.
 *   - last7    — created_at >= now() - 7 days (rolling 7×24h window).
 *   - last30   — created_at >= now() - 30 days (rolling 30×24h window).
 *
 *   An unknown range value returns HTTP 400 with a clear error
 *   message rather than silently falling back. The page UI only
 *   emits known values, so a 400 here points at a typo'd
 *   hand-crafted URL — failing loud surfaces it.
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

export type RangeKey = "lifetime" | "today" | "last7" | "last30";
const ALLOWED_RANGES: ReadonlyArray<RangeKey> = [
  "lifetime",
  "today",
  "last7",
  "last30",
];

const RANGE_LABELS: Record<RangeKey, string> = {
  lifetime: "All time",
  today: "Today (Europe/Dublin)",
  last7: "Last 7 days",
  last30: "Last 30 days",
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
 * Compute "start of today" in Europe/Dublin as a UTC instant.
 * Uses Intl date math so DST transitions (BST ↔ IST) are handled by
 * the Node.js runtime tz database; no hardcoded offsets.
 */
function startOfTodayDublin(now: Date): Date {
  const tz = "Europe/Dublin";
  // 1. Compute today's calendar date in Dublin (e.g. "2026-04-28").
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // 2. Determine Dublin's UTC offset right now via shortOffset:
  //    "GMT" (winter, IST=GMT) or "GMT+1" (summer, BST=UTC+1).
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
  // 3. Dublin midnight as UTC = local-midnight - offsetHours.
  const utcMidnightOfYmd = new Date(`${ymd}T00:00:00Z`).getTime();
  return new Date(utcMidnightOfYmd - offsetHours * 60 * 60 * 1000);
}

function rangeWindow(
  range: RangeKey,
  now: Date,
): { start: Date | null; end: Date | null } {
  if (range === "lifetime") return { start: null, end: null };
  if (range === "today") return { start: startOfTodayDublin(now), end: now };
  if (range === "last7") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now };
  }
  // last30
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end: now };
}

function inRange(
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

export async function GET(req: Request) {
  // Parse + validate range. 400 on unknown values rather than silent
  // fallback — the UI only emits valid values, so a bad value here
  // is a typo or a hand-crafted URL the operator would want to see.
  const url = new URL(req.url);
  const requested = url.searchParams.get("range");
  let range: RangeKey;
  if (requested === null) {
    range = "lifetime";
  } else if ((ALLOWED_RANGES as readonly string[]).includes(requested)) {
    range = requested as RangeKey;
  } else {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_range",
        error: `Invalid range "${requested}". Must be one of: ${ALLOWED_RANGES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const { data, error } = await client
    .from("purchases")
    .select(
      "status, source, price_cents_paid, credits_granted, created_at",
    );
  if (error) {
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

  const allRows = (data ?? []) as PurchaseRow[];
  const now = new Date();
  const { start, end } = rangeWindow(range, now);
  const rows = allRows.filter((r) => inRange(r.created_at, start, end));

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

  const summary: RevenueSummary = {
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
  return NextResponse.json(summary);
}
