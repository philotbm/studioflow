import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.4.3",
    release: "Attendance Backend Parity Restore",
  });
}
