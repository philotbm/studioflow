import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";

/**
 * v0.21.0.4 — Sentry + logger smoke-test endpoint (TEMPORARY).
 *
 * Proxy-gated to manager/owner via /api/dev/* in src/proxy.ts, so
 * anonymous traffic is rejected before reaching this handler.
 *
 * Behaviour matrix:
 *   GET /api/dev/sentry-test            → 200 OK + a logger.info line
 *   GET /api/dev/sentry-test?throw=1    → throws — error captured by
 *                                         instrumentation onRequestError
 *                                         and forwarded to Sentry
 *
 * Remove this route in a follow-up PR once Phil has confirmed
 * Sentry is receiving events with real stack traces. The matching
 * tracking task lives in the v0.21.0.4 PR description.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const shouldThrow = req.nextUrl.searchParams.get("throw") === "1";

  logger.info({
    event: "sentry_test_invoked",
    shouldThrow,
    path: req.nextUrl.pathname,
  });

  if (shouldThrow) {
    throw new Error("Sentry smoke test — deliberate throw from /api/dev/sentry-test");
  }

  return NextResponse.json({
    ok: true,
    hint: "Append ?throw=1 to trigger a Sentry-captured error.",
  });
}
