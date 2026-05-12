import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// v0.22.3 diagnostic: prints at module-load time, which happens during
// Vercel BUILD (not Runtime). If this line is missing from the build
// log, next.config.ts isn't being loaded — the bigger-than-Sentry
// problem. Pairs with the v0.22.1 / v0.22.2 runtime logs to triangulate
// where the instrumentation chain breaks. Remove once Sentry capture is
// confirmed working.
console.log(
  "[next.config] module loaded, NODE_ENV:",
  process.env.NODE_ENV,
  "VERCEL_ENV:",
  process.env.VERCEL_ENV,
);

// v0.23.1 — system-wide Sentry runtime capture fix.
//
// Force instrumentation.ts (and the two Sentry config files it
// dynamic-imports) into every per-function NFT trace. Without this,
// Vercel + Next 16 + Turbopack ships function bundles that lack the
// compiled instrumentation.js — route-module.js's loader silently
// swallows the resulting MODULE_NOT_FOUND, register() never runs,
// and Sentry's onRequestError handler never wires up.
//
// Bug confirmed locally pre-fix by grepping
// .next/server/app/api/health/route.js.nft.json — only Next's
// internal instrumentation-globals.external.js loader appeared;
// user-level instrumentation.js was absent.
//
// Open-question resolution (see docs/specs/sentry_fix.md):
//
//   #1 Namespace: top-level. Confirmed against
//      node_modules/next/dist/server/config-shared.d.ts line 1238
//      (outputFileTracingIncludes is on NextConfig, not nested
//      under ExperimentalConfig).
//
//   #2 Glob pattern: the double-star route glob. Next uses
//      picomatch with `{ contains: true }`
//      (collect-build-traces.js line 466), so this substring-
//      matches every route. Per the Next 16 docs at
//      node_modules/next/dist/docs/01-app/03-api-reference/05-config/
//      01-next-config-js/output.md, the single-star key is the
//      canonical "all routes" pattern — both work because of
//      `contains: true`, so following the spec.
//
//   #3 Path resolution: project-root-relative source paths
//      (Sentry SDK community / spec-prescribed pattern). The
//      premise is that Next's NFT pipeline traces source ->
//      compiled output through the dependency graph and adds
//      the compiled equivalents to each function bundle.
//
//      Caveat documented for Phil during PR review: local
//      `next build` followed by inspection of
//      .next/server/app/api/health/route.js.nft.json shows
//      `instrumentation.ts` (source) in the trace but does
//      NOT show `.next/server/instrumentation.js` (compiled).
//      Attempts to add compiled paths directly via
//      `.next/server/instrumentation.js` /
//      `.next/server/chunks/**/*` ALSO didn't land in the
//      trace — `.next/` paths appear to be silently filtered
//      out somewhere in the Next 16 + Turbopack include
//      pipeline. The Vercel build adapter may behave
//      differently from local; the spec's verification matrix
//      (Phil hits /api/health with a temporary `?throw=1` and
//      checks Sentry within 30s) is the authoritative test.
//      If verification fails, rollback is git revert <merge>
//      and we iterate to option 2 from the v0.22.4 PR analysis
//      (shared init module imported per-entry-point).
//
// (JSDoc-style block comment intentionally avoided here: the
// literal glob pattern contains a `*` followed by `/` which would
// close a `/** ... */` comment prematurely.)
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "**/*": [
      "./instrumentation.ts",
      "./sentry.server.config.ts",
      "./sentry.edge.config.ts",
    ],
  },
};

/**
 * Sentry build-time wrapper (source-map upload + bundler plugin).
 *
 * Source-map upload requires SENTRY_AUTH_TOKEN at build time. Without
 * it, the build still succeeds (the plugin is non-blocking) but
 * Sentry stack traces show minified frames until the env var is set
 * in Vercel Production scope. SENTRY_ORG / SENTRY_PROJECT identify
 * the destination.
 *
 * `silent: !process.env.CI` keeps local builds quiet; CI prints the
 * upload log so deploy issues are visible in Vercel build output.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
