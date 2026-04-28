import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.19.0",
    release: "Booking Recovery / Rebooking Foundation",
  });
}
