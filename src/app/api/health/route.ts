import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    system: "studioflow",
    version: "v0.21.0",
    release: "Operator + Instructor Auth (RBAC)",
  });
}
