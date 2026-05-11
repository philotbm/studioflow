import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

/**
 * v0.21.0.4 / v0.22.4 — Sentry + logger smoke-test endpoint (TEMPORARY).
 *
 * Proxy-gated to manager/owner via /api/dev/* in src/proxy.ts.
 *
 * v0.22.4 workaround for the instrumentation-hook-not-firing bug:
 * instrumentation.ts's register() is not running on Vercel + Next 16
 * + Turbopack because the per-function NFT trace doesn't include
 * .next/server/instrumentation.js. Confirmed locally:
 *
 *   $ next build
 *   $ grep instrumentation .next/server/app/api/health/route.js.nft.json
 *   → only Next's internal instrumentation-globals.external.js loader
 *     is listed; the user-level instrumentation.js file is absent.
 *
 * Route-module.js then silently swallows MODULE_NOT_FOUND when its
 * loader tries `require('<distDir>/server/instrumentation.js')`. So
 * register() is never called and the v0.22.1 + v0.22.2 boot logs
 * never fire.
 *
 * Workaround: bypass the instrumentation hook entirely with a
 * route-local Sentry.init() at module top. Sentry.captureException +
 * await Sentry.flush(2000) below force the deliberate throw to be
 * captured and posted to ingestion before the function process
 * terminates. This is purely for the smoke test — it confirms the
 * Sentry SDK + DSN + network path all work end-to-end and lets us
 * stop chasing the runtime-capture rabbit hole while Cowork plans the
 * real fix (force instrumentation.js into NFT traces via
 * outputFileTracingIncludes, or move Sentry init off the
 * instrumentation hook entirely if the Sentry SDK has shipped a
 * different recommended pattern for Next 16 + Turbopack).
 *
 * Remove this route + workaround in a follow-up PR once Sentry
 * runtime capture is confirmed working via either of the two real-fix
 * paths above.
 *
 * Behaviour matrix:
 *   GET /api/dev/sentry-test          → 200 OK + a logger.info line
 *   GET /api/dev/sentry-test?throw=1  → captureException + flush, then
 *                                       throw (which Next returns as 500)
 */

// v0.22.4: route-local Sentry init. Runs at module load on cold start;
// no-op on warm invocations because Sentry.init de-duplicates. The
// console.log prints to Vercel Runtime Logs — pairs with the
// captureException + flush below so we can confirm the SDK path on
// cold-start vs. warm.
const _ROUTE_LOCAL_SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (_ROUTE_LOCAL_SENTRY_DSN) {
  console.log(
    "[sentry-test] route-local Sentry.init() at module load, DSN: set",
  );
  Sentry.init({
    dsn: _ROUTE_LOCAL_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
} else {
  console.warn(
    "[sentry-test] NEXT_PUBLIC_SENTRY_DSN missing at module load — route-local init skipped",
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const shouldThrow = req.nextUrl.searchParams.get("throw") === "1";

  logger.info({
    event: "sentry_test_invoked",
    shouldThrow,
    path: req.nextUrl.pathname,
  });

  if (shouldThrow) {
    const err = new Error(
      "Sentry smoke test — deliberate throw from /api/dev/sentry-test",
    );
    // v0.22.4: belt-and-braces. Explicit capture + flush bypasses
    // the (currently dead) instrumentation onRequestError path.
    Sentry.captureException(err);
    await Sentry.flush(2000);
    throw err;
  }

  return NextResponse.json({
    ok: true,
    hint: "Append ?throw=1 to trigger a Sentry-captured error.",
  });
}
