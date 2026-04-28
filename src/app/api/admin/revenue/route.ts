import { NextResponse } from "next/server";
import { fetchRevenue, parseRange } from "@/lib/revenue";

/**
 * v0.17.2 GET-only revenue summary.
 *
 * Thin wrapper. All eligibility, range, and aggregation logic lives
 * in `@/lib/revenue` so this route and `/api/admin/revenue/export`
 * compute identical numbers.
 *
 *   ?range=lifetime|today|last7|last30  (default: lifetime)
 *   Unknown range → HTTP 400 with code:"invalid_range".
 *
 * GET-safe and read-only. POST is deliberately not exported.
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseRange(url.searchParams.get("range"));
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: "invalid_range", error: parsed.error },
      { status: 400 },
    );
  }

  const result = await fetchRevenue(parsed.range);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result.summary);
}
