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

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
});
