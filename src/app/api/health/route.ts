// v0.23.1: side-effect Sentry init. /api/health doesn't transitively
// import src/lib/supabase.ts, so the universal-via-Supabase init path
// doesn't cover this function. Pulling sentry-init in explicitly here
// gives Phil a no-auth verification target for preview deploys.
// REMOVED in v0.23.2 cleanup (along with the throw harness below).
import "@/lib/sentry-init";

import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

export async function GET(req: NextRequest) {
  // v0.23.1 verification harness — REMOVED in v0.23.2 cleanup.
  // Explicit captureException + flush mirroring the v0.22.4 pattern
  // in /api/dev/sentry-test. If Sentry.init() actually ran via the
  // side-effect import above, this WILL land in Sentry. The
  // [sentry-init] module-load console.log canary tells us whether
  // the side-effect import ran at all — distinguishing
  // "import tree-shaken away" from "init ran but auto-capture
  // doesn't fire for Next 16 app-router routes."
  if (req.nextUrl.searchParams.get("throw") === "1") {
    const err = new Error("Sentry shared-init smoke — deliberate throw from /api/health");
    Sentry.captureException(err);
    await Sentry.flush(2000);
    throw err;
  }
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.21.0",
    release: "Operator + Instructor Auth (RBAC)",
  });
}
