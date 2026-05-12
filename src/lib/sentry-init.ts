/**
 * v0.23.1 — Sentry shared init module (system-wide capture).
 *
 * Side-effect import target. Imported once each from src/proxy.ts
 * (edge runtime, fires on every request before route dispatch) and
 * src/lib/supabase.ts (node runtime, transitive via every
 * scopedQuery caller — every route handler / RSC / server action
 * that hits Supabase pulls this in via the existing import graph).
 *
 * Replaces the instrumentation.ts → sentry.{server,edge}.config.ts
 * dispatch chain. Upstream Next.js bug
 * (https://github.com/vercel/next.js/issues/89377) excludes the
 * compiled instrumentation.js from per-function NFT bundles on
 * Turbopack, so the instrumentation hook never runs on Vercel
 * prod / preview deploys. This shared init module bypasses that
 * broken pipeline — Sentry.init() runs at module-load time on
 * whichever runtime the importing file is bundled into.
 *
 * Once the upstream fix ships (@vercel/nft >= 0.30.0 in a future
 * Next.js release), the instrumentation.ts hook will start working
 * again. Sentry.init's internal de-dup makes this module harmless
 * in that scenario — it's safe to leave in place permanently as a
 * belt-and-braces guarantee.
 *
 * Why this fires on cold start: the importing modules
 * (src/proxy.ts, src/lib/supabase.ts) are loaded before the first
 * request enters any handler. ESM module evaluation runs top-down,
 * so this side-effect import resolves before any of the importing
 * module's own code runs.
 *
 * Capture mechanism (open question #1 from the spec): once init has
 * run, Sentry's Node SDK registers as a listener for the
 * OpenTelemetry HTTP / route-handler spans Next.js emits natively
 * (per Next 15+/16). Unhandled errors thrown inside a span surface
 * to Sentry as captured events with the route's stack frame and
 * request metadata. No per-handler `captureException` boilerplate
 * is needed. If the verification harness throw on /api/qa/status
 * doesn't capture this way, the fallback is the v0.22.4 pattern:
 * explicit Sentry.captureException(err) + await Sentry.flush(2000).
 *
 * PII discipline: same scrub list as sentry.server.config.ts —
 * email / phone / last4 / password stripped from event.request.data
 * and event.extra before transmission. Session replay is disabled
 * (paid feature, no GDPR DPA).
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      scrubPii(event.request?.data);
      scrubPii(event.extra);
      return event;
    },
  });
}

function scrubPii(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  for (const key of ["email", "phone", "last4", "password"]) {
    delete record[key];
  }
}
