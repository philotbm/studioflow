import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { isSafeNextPath } from "@/lib/auth";

import { wrapRouteHandlerWithSentry } from "@sentry/nextjs";
/**
 * v0.20.1 magic-link decision tree (v0.21.0: staff intent branch).
 *
 * Replaces the dead-on-prod /auth/callback client page from M1. With
 * PKCE flow now configured on the browser client, magic links arrive
 * here as `?code=…&next=…` and we run the auth handshake server-side
 * so we can branch on the user's claim state and 302 to the right
 * place — instead of letting Supabase drop the user back at Site URL.
 *
 * v0.21.0 adds an `intent` parameter set by /staff/login when it
 * builds emailRedirectTo. When intent=staff, the staff-row check
 * runs first and the member-resolution branches are skipped. This
 * makes the SAME Supabase user able to hold both a staff row AND a
 * members row (Phil's case): login surface choice is the
 * disambiguator, not a chooser page.
 *
 * Decision tree (in order):
 *
 *   1. exchangeCodeForSession(code) → if it errors, redirect to
 *      the appropriate login (member or staff) with the reason.
 *   2. (v0.21.0) intent=staff
 *        → staff row exists → redirect to next ?? '/app'
 *        → no staff row → /staff/login?error=not-authorised
 *      Staff intent NEVER falls back to member-resolution — a magic
 *      link sent from /staff/login to a non-staff email must surface
 *      as "not authorised", not silently route to /my/{slug}.
 *   3. user already has a linked members row (user_id = uid())
 *        → if `next` is safe, redirect there
 *        → else redirect to /my/{linked.slug}
 *      We deliberately ignore any un-claimed siblings at the same
 *      email — the M1 UNIQUE(user_id) index makes a second link
 *      impossible today; M3 reopens this when the index becomes
 *      UNIQUE(studio_id, user_id).
 *   4. no linked row, but at least one un-claimed members row matches
 *      the auth user's email AND has a phone on file
 *        → redirect to /auth/claim?next=…
 *      Phone is required because the claim handshake is
 *      email-match + phone-last-4. A row with no phone is
 *      indistinguishable from "studio hasn't onboarded this person
 *      for self-claim yet" — route to the friendly error.
 *   5. anything else → /login?error=no-member.
 *
 * Open-redirect / loop safety: `next` is filtered through
 * isSafeNextPath before it's ever returned in a 302 Location header.
 */

function loginRedirect(origin: string, params: Record<string, string>) {
  const url = new URL("/login", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function staffLoginRedirect(
  origin: string,
  params: Record<string, string>,
) {
  const url = new URL("/staff/login", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export const GET = wrapRouteHandlerWithSentry(
  async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const intent = url.searchParams.get("intent") ?? "member";
  const errorDescription = url.searchParams.get("error_description");
  const origin = url.origin;

  const isStaff = intent === "staff";
  const failRedirect = isStaff ? staffLoginRedirect : loginRedirect;

  if (errorDescription) {
    return failRedirect(origin, { error: "auth", reason: errorDescription });
  }
  if (!code) {
    return failRedirect(origin, { error: "auth", reason: "missing_code" });
  }

  const supabase = await getSupabaseServerAuthClient();
  if (!supabase) {
    return failRedirect(origin, { error: "auth", reason: "not_configured" });
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
  );
  if (exchangeError) {
    return failRedirect(origin, {
      error: "auth",
      reason: exchangeError.message,
    });
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return failRedirect(origin, { error: "auth", reason: "no_session" });
  }

  // v0.21.0 — staff intent runs first and never falls back to
  // member resolution. A user holding both rows is routed by their
  // login surface choice, not by a chooser page.
  if (isStaff) {
    const { data: staffRow } = await supabase
      .from("staff")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!staffRow) {
      return staffLoginRedirect(origin, { error: "not-authorised" });
    }

    if (isSafeNextPath(nextParam)) {
      return NextResponse.redirect(new URL(nextParam, origin));
    }
    return NextResponse.redirect(new URL("/app", origin));
  }

  // 1. Already linked? Honour next-or-home.
  const { data: linked } = await supabase
    .from("members")
    .select("slug")
    .eq("user_id", user.id)
    .maybeSingle();

  if (linked?.slug) {
    if (isSafeNextPath(nextParam)) {
      return NextResponse.redirect(new URL(nextParam, origin));
    }
    return NextResponse.redirect(new URL(`/my/${linked.slug}`, origin));
  }

  // 2. Un-claimed candidates at this email with a phone on file?
  if (user.email) {
    const { data: candidates } = await supabase
      .from("members")
      .select("id")
      .eq("email", user.email)
      .is("user_id", null)
      .not("phone", "is", null)
      .limit(1);

    if (candidates && candidates.length >= 1) {
      const claimUrl = new URL("/auth/claim", origin);
      if (isSafeNextPath(nextParam)) {
        claimUrl.searchParams.set("next", nextParam);
      }
      return NextResponse.redirect(claimUrl);
    }
  }

  // 3. No match.
  return loginRedirect(origin, { error: "no-member" });
},
  { method: "GET", parameterizedRoute: "/auth/callback" },
);
