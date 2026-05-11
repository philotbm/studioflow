import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
