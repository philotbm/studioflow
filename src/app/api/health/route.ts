// v0.23.2: explicit side-effect Sentry init. PERMANENT — /api/health
// doesn't import src/lib/supabase.ts, so the universal-via-Supabase
// init path doesn't cover this function. Without this import, the
// wrapper below would still capture, but Sentry would never have
// initialized in the first place. Keep this line as long as
// /api/health exists.
import "@/lib/sentry-init";

import { NextResponse } from "next/server";
import { withSentryCapture } from "@/lib/with-sentry";

export const GET = withSentryCapture(
  async function GET(): Promise<NextResponse> {
    return NextResponse.json({
      status: "ok",
      system: "studioflow",
      version: "v0.23.3",
      release: "Sentry wrapper rollout",
    });
  },
  { method: "GET", parameterizedRoute: "/api/health" },
);
