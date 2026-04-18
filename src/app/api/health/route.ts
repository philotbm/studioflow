import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.9.0.1",
    release: "Eligibility QA Closure",
  });
}
