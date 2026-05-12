// v0.23.1: side-effect Sentry init. /api/health doesn't transitively
// import src/lib/supabase.ts, so the universal-via-Supabase init path
// doesn't cover this function. Pulling sentry-init in explicitly here
// gives Phil a no-auth verification target for preview deploys.
// REMOVED in v0.23.2 cleanup (along with the throw harness below).
import "@/lib/sentry-init";

import { NextResponse, type NextRequest } from "next/server";

export function GET(req: NextRequest) {
  // v0.23.1 verification harness — REMOVED in v0.23.2 cleanup.
  if (req.nextUrl.searchParams.get("throw") === "1") {
    throw new Error("Sentry shared-init smoke — deliberate throw from /api/health");
  }
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.21.0",
    release: "Operator + Instructor Auth (RBAC)",
  });
}
