import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.15.1.1",
    release: "Purchase Migration Resilience",
  });
}
