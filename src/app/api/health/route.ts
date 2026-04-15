import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.0",
    release: "Economic Truth Hardening + Credit Control",
  });
}
