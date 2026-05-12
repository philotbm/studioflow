import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerAuthClient } from "@/lib/supabase";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
/**
 * v0.20.1 / v0.21.0 sign-out route.
 *
 * Accepts both GET (links from the gate panel and claim page point
 * here) and POST (form actions) so the same URL works for both UI
 * surfaces. Calls supabase.auth.signOut() to clear the cookie
 * session, then 302s back to the appropriate login surface.
 *
 * v0.21.0 — `?intent=staff` routes the post-signout landing to
 * /staff/login. Without it, signout lands at /login (the member
 * surface) as before. The signed-out user could re-enter via either
 * surface, but routing them back to where they started removes a
 * confusing detour for staff users who don't have a member row.
 *
 * The optional `next` param is preserved through the round-trip in
 * case sign-out was triggered from a flow that's still trying to
 * land somewhere specific.
 */

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");
  const intent = url.searchParams.get("intent");

  const supabase = await getSupabaseServerAuthClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const loginPath = intent === "staff" ? "/staff/login" : "/login";
  const loginUrl = new URL(loginPath, url.origin);
  if (nextParam) loginUrl.searchParams.set("next", nextParam);
  return NextResponse.redirect(loginUrl);
}

export const GET = wrapRouteHandlerWithSentry(
  async function GET(req: NextRequest) {
  return handle(req);
},
  { method: "GET", parameterizedRoute: "/auth/signout" },
);

export const POST = wrapRouteHandlerWithSentry(
  async function POST(req: NextRequest) {
  return handle(req);
},
  { method: "POST", parameterizedRoute: "/auth/signout" },
);
