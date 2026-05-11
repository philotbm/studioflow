/**
 * v0.21.0.4 — Sentry client (browser) init.
 *
 * Scanned at build time by @sentry/nextjs webpack plugin and injected
 * into every client bundle. Sentry's docs still recommend this file
 * for the client SDK init even in v10.x (the deprecation note only
 * covers sentry.server.config / sentry.edge.config — those have moved
 * into instrumentation.ts).
 *
 * PII discipline: GDPR-friendly. We pass member emails and phone
 * numbers through /auth/callback, /api/admin/*, and the claim flow.
 * Strip them from event payloads in `beforeSend` before they leave
 * the browser. Session replay is disabled (paid feature, no DPA).
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
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
