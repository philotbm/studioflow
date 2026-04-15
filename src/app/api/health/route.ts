import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.7.0",
    release: "Economic Engine — Consumption + Server Enforcement",
  });
}
