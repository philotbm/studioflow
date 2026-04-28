import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.18.2",
    release: "Receipt Direct-Link Reliability",
  });
}
