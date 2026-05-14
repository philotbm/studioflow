// v0.23.2: explicit side-effect Sentry init. PERMANENT — /api/health
// doesn't import src/lib/supabase.ts, so the universal-via-Supabase
// init path doesn't cover this function. Without this import, the
// wrapper below would still capture, but Sentry would never have
// initialized in the first place. Keep this line as long as
// /api/health exists.
import "@/lib/sentry-init";

import { NextResponse } from "next/server";
import { withSentryCapture } from "@/lib/with-sentry";

/**
 * Public health endpoint. Returns 200 + a minimal JSON body so a
 * watchdog or a deploy-readiness probe can confirm the server boots
 * and the Sentry init side-effect import resolved.
 *
 * `version` is bumped manually on each SemVer release. Keep it in
 * sync with package.json. (We don't import package.json here on
 * purpose — it'd pull the whole manifest into the route's serverless
 * bundle.)
 */
export const GET = withSentryCapture(
  async function GET(): Promise<NextResponse> {
    return NextResponse.json({
      status: "ok",
      system: "studioflow",
      version: "v0.23.5",
    });
  },
  { method: "GET", parameterizedRoute: "/api/health" },
);
