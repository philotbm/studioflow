/**
 * v0.21.0.4 — Sentry edge runtime init.
 *
 * Imported by `instrumentation.ts` register() when NEXT_RUNTIME is
 * "edge". Used for src/proxy.ts (the Next 16 renamed middleware) and
 * any route handlers that opt into the edge runtime.
 *
 * The edge runtime is a strict subset of Node; PII scrubbing on the
 * request body is intentionally omitted here because edge errors
 * surface at the proxy/cookie layer and don't carry request bodies
 * the same way server routes do.
 */
import * as Sentry from "@sentry/nextjs";

// v0.22.1 diagnostic: confirm via Vercel Runtime Logs that this module
// is actually being loaded by instrumentation.ts's register() hook AND
// that the DSN env var is reaching the edge runtime. Remove once
// runtime capture is confirmed working.
console.log(
  "[Sentry] edge config booting, DSN:",
  process.env.NEXT_PUBLIC_SENTRY_DSN ? "set" : "missing",
);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
});
