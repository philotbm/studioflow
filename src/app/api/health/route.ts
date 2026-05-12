import { NextResponse, type NextRequest } from "next/server";

export function GET(req: NextRequest) {
  // v0.23.1 verification harness — REMOVED in v0.23.2 cleanup.
  if (req.nextUrl.searchParams.get("throw") === "1") {
    throw new Error("Sentry instrumentation smoke — deliberate throw from /api/health");
  }
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.21.0",
    release: "Operator + Instructor Auth (RBAC)",
  });
}
