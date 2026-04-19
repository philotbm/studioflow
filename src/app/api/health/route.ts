import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.9.3",
    release: "Post-Enforcement Cleanup + QA Hardening",
  });
}
