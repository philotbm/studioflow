import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.5",
    release: "Attendance Reconciliation + Operator Intelligence",
  });
}
