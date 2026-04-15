import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.3",
    release: "Check-In as Attendance Truth + QR",
  });
}
