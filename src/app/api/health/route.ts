import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.17.1",
    release: "Revenue Date Filters",
  });
}
