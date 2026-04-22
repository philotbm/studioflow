import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.13.3",
    release: "Membership Truth + Member Home Temporal Sanity",
  });
}
