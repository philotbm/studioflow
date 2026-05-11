/**
 * v0.21.0.4 — Sentry server (Node.js runtime) init.
 *
 * Imported by `instrumentation.ts` register() when NEXT_RUNTIME is
 * "nodejs". Sentry 10.x requires server-side init to go through the
 * Next.js instrumentation hook rather than the legacy
 * `sentry.server.config.ts` auto-injection.
 *
 * PII discipline: Sentry's server SDK auto-captures the request URL
 * and headers (auth tokens are scrubbed by default) but NOT request
 * bodies. We strip PII fields in `beforeSend` defensively in case any
 * downstream integration attaches them.
 */
import * as Sentry from "@sentry/nextjs";

// v0.22.1 diagnostic: confirm via Vercel Runtime Logs that this module
// is actually being loaded by instrumentation.ts's register() hook AND
// that the DSN env var is reaching the server process. Remove once
// runtime capture is confirmed working.
console.log(
  "[Sentry] server config booting, DSN:",
  process.env.NEXT_PUBLIC_SENTRY_DSN ? "set" : "missing",
);

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

function scrubPii(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  for (const key of ["email", "phone", "last4", "password"]) {
    delete record[key];
  }
}
