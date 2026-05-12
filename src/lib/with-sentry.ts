/**
 * v0.23.2 — explicit Sentry capture wrapper for Next.js App Router
 * route handlers on Vercel serverless.
 *
 * Mirrors the API surface of @sentry/nextjs's wrapRouteHandlerWithSentry
 * but uses the explicit captureException + flush pattern that
 * v0.23.1 verification proved works on Vercel + Next 16 + Turbopack.
 *
 * Why not just use wrapRouteHandlerWithSentry: on Vercel serverless
 * the wrapper queues events to Sentry's hub but doesn't flush before
 * the function process exits. Events are lost. Verified empirically
 * in the v0.23.2 PR #77 preview deploy (SHA 1bf6d85) — wrapper threw
 * HTTP 500, Vercel logged the Error, but the External APIs panel
 * showed "No outgoing requests" to Sentry's ingestion endpoint. The
 * v0.23.1 explicit-flush pattern, by contrast, produced 3 POSTs to
 * o4511373266190336.ingest.de.sentry.io on the same throw. This HOF
 * packages that proven pattern so call-sites don't repeat the
 * captureException + flush boilerplate.
 *
 * The `_context` arg is unused at runtime but kept for documentation
 * parity with wrapRouteHandlerWithSentry (and in case we ever want
 * to enrich the captured event with route metadata via scope).
 */
import * as Sentry from "@sentry/nextjs";

export interface RouteHandlerContext {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  parameterizedRoute: string;
}

export function withSentryCapture<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Args extends any[],
  R,
>(
  handler: (...args: Args) => Promise<R>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: RouteHandlerContext,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      Sentry.captureException(err);
      await Sentry.flush(2000);
      throw err;
    }
  };
}
