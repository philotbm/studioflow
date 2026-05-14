"use server";

import { cookies } from "next/headers";
import {
  LOGIN_INTENT_COOKIE,
  LOGIN_INTENT_TTL_SECONDS,
  type LoginIntentValue,
  encodeLoginIntent,
} from "@/lib/login-intent";

/**
 * v0.23.4 — Server action invoked by /login and /staff/login right
 * before they call supabase.auth.signInWithOtp.
 *
 * Sets an HttpOnly cookie carrying the user's intent (which form they
 * came from) and their desired post-login `next`. /auth/callback reads
 * and clears the cookie after the PKCE exchange to decide where to
 * 302. Lets the login flow stop encoding intent + next as query params
 * on emailRedirectTo, which Supabase's strict allow-list rejects.
 *
 * See src/lib/login-intent.ts for the rationale and cookie format.
 *
 * No authentication required — the action only writes a cookie and
 * returns. Input is validated: invalid intents throw at encode time,
 * malformed `next` paths are stored as null (cookie reader treats the
 * missing field as "no next, use default").
 */
export async function setLoginIntent(params: {
  intent: LoginIntentValue;
  next: string | null;
}): Promise<void> {
  const value = encodeLoginIntent(params);
  const cookieStore = await cookies();
  cookieStore.set({
    name: LOGIN_INTENT_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    maxAge: LOGIN_INTENT_TTL_SECONDS,
    path: "/",
  });
}
