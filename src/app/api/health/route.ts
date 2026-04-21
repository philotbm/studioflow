import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.12.1",
    release: "No-Entitlement Member Fix",
  });
}
