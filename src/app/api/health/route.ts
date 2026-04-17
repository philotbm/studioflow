import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.8.4.2",
    release: "QA Fixture Activation + Fallback Safety",
  });
}
