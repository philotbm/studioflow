import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.9.4.1",
    release: "Booking Truth Simplification",
  });
}
