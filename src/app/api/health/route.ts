// v0.23.2: explicit side-effect Sentry init. PERMANENT — /api/health
// doesn't import src/lib/supabase.ts, so the universal-via-Supabase
// init path doesn't cover this function. Without this import, the
// wrapper below would still capture, but Sentry would never have
// initialized in the first place. Keep this line as long as
// /api/health exists.
import "@/lib/sentry-init";

import { NextResponse, type NextRequest } from "next/server";
import { withSentryCapture } from "@/lib/with-sentry";

export const GET = withSentryCapture(
  async function GET(req: NextRequest): Promise<NextResponse> {
    // v0.23.2 verification harness — REMOVED in v0.23.3.
    if (req.nextUrl.searchParams.get("throw") === "1") {
      throw new Error("Sentry wrapper smoke — deliberate throw from /api/health");
    }
    return NextResponse.json({
      status: "ok",
      system: "studioflow",
      version: "v0.23.2",
      release: "Sentry wrapper rollout",
    });
  },
  { method: "GET", parameterizedRoute: "/api/health" },
);
