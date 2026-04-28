import { NextResponse } from "next/server";
import {
  fetchRevenue,
  parseRange,
  sourceDisplayLabel,
  type RevenueSummary,
} from "@/lib/revenue";
import { formatPriceEur } from "@/lib/plans";

/**
 * v0.17.2 GET-only revenue CSV export.
 *
 *   ?range=lifetime|today|last7|last30  (default: lifetime)
 *
 * Reuses @/lib/revenue's fetchRevenue, so the CSV numbers are
 * provably identical to the JSON numbers from /api/admin/revenue
 * with the same range — same Supabase fetch, same eligibility
 * filter, same aggregation pass.
 *
 * Unknown range → HTTP 400 with code:"invalid_range" (matches the
 * JSON endpoint's behaviour).
 *
 * Response:
 *   - Content-Type: text/csv; charset=utf-8
 *   - Content-Disposition: attachment; filename="studioflow-revenue-{range}-{YYYY-MM-DD}.csv"
 *
 * The filename date is "today" in Europe/Dublin (the studio's
 * timezone), so an operator running an export at 00:15 Dublin sees
 * the new date in the filename, not the previous UTC date.
 *
 * GET-safe and read-only.
 */

export const runtime = "nodejs";

/** Quote a CSV cell only when it contains comma, quote, CR, or LF. */
function csvCell(v: string | number): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** YYYY-MM-DD for today in Europe/Dublin. Used for filename. */
function todayDublinYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function buildCsv(summary: RevenueSummary, generatedAt: Date): string {
  const lines: string[] = [];
  const push = (cells: Array<string | number>) =>
    lines.push(cells.map(csvCell).join(","));

  // Metadata header — single-cell title row + key/value rows so the
  // file is readable both as raw text and after spreadsheet import.
  push(["StudioFlow Revenue Export"]);
  push(["Range label", summary.rangeLabel]);
  push(["Range start", summary.rangeStart ?? ""]);
  push(["Range end", summary.rangeEnd ?? ""]);
  push(["Generated at", generatedAt.toISOString()]);
  lines.push("");

  // Summary section.
  push(["Metric", "Value"]);
  push(["Gross revenue", formatPriceEur(summary.grossRevenueCents)]);
  push(["Refunded revenue", formatPriceEur(summary.refundedRevenueCents)]);
  push(["Net revenue", formatPriceEur(summary.netRevenueCents)]);
  push(["Completed purchases", summary.completedCount]);
  push(["Refunded purchases", summary.refundedCount]);
  push(["Legacy purchases excluded", summary.legacyExcludedCount]);
  push(["Total purchases in range", summary.totalRows]);
  lines.push("");

  // Source breakdown section. Always emits a euro value (€0.00) for
  // refunded €, instead of the page UI's "—" placeholder, so the
  // column is uniformly numeric for spreadsheet sums.
  push(["Source", "Completed", "Revenue", "Refunded", "Refunded €", "Net €"]);
  for (const row of summary.bySource) {
    push([
      sourceDisplayLabel(row.source),
      row.countCompleted,
      formatPriceEur(row.revenueCompletedCents),
      row.countRefunded,
      formatPriceEur(row.revenueRefundedCents),
      formatPriceEur(row.netRevenueCents),
    ]);
  }
  // Trailing newline — convention for CSV files.
  return lines.join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseRange(url.searchParams.get("range"));
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: "invalid_range", error: parsed.error },
      { status: 400 },
    );
  }

  const now = new Date();
  // Use the same `now` for fetchRevenue (range window) and the
  // generated-at metadata so the CSV header timestamp can never
  // disagree with the rangeEnd it claims.
  const result = await fetchRevenue(parsed.range, now);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.error },
      { status: result.status },
    );
  }

  const csv = buildCsv(result.summary, now);
  const filename = `studioflow-revenue-${parsed.range}-${todayDublinYmd(now)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
