/**
 * v0.21.0.4 — Next.js instrumentation hook (Sentry dispatch).
 *
 * Per the Next.js 16 instrumentation docs
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md):
 *   - `register()` runs once per server instance startup. We use it
 *     to load the correct Sentry init module for the active runtime.
 *   - `onRequestError` reports server errors to Sentry. The
 *     `captureRequestError` export from @sentry/nextjs is the
 *     canonical handler for this hook.
 *
 * Sentry 10.x deprecated the legacy auto-loading of
 * sentry.server.config.ts / sentry.edge.config.ts and now requires
 * server-side init to happen inside this register() function. The
 * config files themselves stay (loaded via dynamic import below) so
 * the per-runtime Sentry.init() lives in a dedicated, grep-able file.
 *
 * Mentioning `@sentry/nextjs` in this file suppresses the Sentry
 * webpack plugin's "you have a deprecated sentry.{server,edge}.config
 * file" warning — see node_modules/@sentry/nextjs/build/cjs/config/
 * webpack.js, `warnAboutDeprecatedConfigFiles`.
 */
export { captureRequestError as onRequestError } from "@sentry/nextjs";

export async function register(): Promise<void> {
  // v0.22.2 diagnostic: v0.22.1 boot logs never appeared in Vercel
  // Runtime Logs, so register() is either not being called at all or
  // not dispatching to the server config branch. These four lines
  // distinguish those failure modes. Remove once runtime capture is
  // confirmed working.
  console.log(
    "[instrumentation] register() called, NEXT_RUNTIME:",
    process.env.NEXT_RUNTIME,
  );
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] nodejs branch entered, awaiting import");
    await import("./sentry.server.config");
    console.log("[instrumentation] nodejs branch import resolved");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
