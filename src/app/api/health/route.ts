import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.4.1",
    release: "Deterministic QA Fixtures + Temporal Test Control",
  });
}
