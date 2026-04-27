import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.14.3.1",
    release: "Active Plan Source-of-Truth Fix",
  });
}
