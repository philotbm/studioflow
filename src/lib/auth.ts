import type { User } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  getSupabaseBrowserAuthClient,
  getSupabaseServerAuthClient,
} from "./supabase";

/**
 * v0.20.0 / v0.20.1 Member auth helpers.
 *
 * The slug remains the public URL. The credential is auth.uid()
 * linked to members.user_id (v0.20.0_migration.sql). v0.20.1 swaps
 * the underlying session storage from localStorage to the
 * @supabase/ssr cookie-backed clients so the server-side
 * /auth/callback decision tree can read the session, while keeping
 * the existing public surface (`requireMemberAccess`,
 * `requireMemberAccessForRequest`) byte-for-byte compatible.
 *
 * Three access paths:
 *
 *   1. Client (React tree under /my, /login, /auth/claim form): the
 *      browser auth client persists the session in cookies.
 *      `getCurrentUser()` and `requireMemberAccess(slug)` read it.
 *
 *   2. Server with cookies (server components / route handlers /
 *      server actions): `getCurrentUserFromCookies()` and
 *      `requireMemberAccessFromCookies(slug)` read the same session
 *      via the SSR client. New in v0.20.1, used by /auth/callback,
 *      /auth/claim, /auth/signout.
 *
 *   3. Server with Bearer token (cross-origin API requests like the
 *      Stripe checkout endpoint): the client forwards
 *      `Authorization: Bearer <access_token>`.
 *      `getCurrentUserFromRequest(req)` validates it.
 *      `requireMemberAccessForRequest(req, slug)` adds the slug check.
 *      Contract is unchanged from v0.20.0 — the Stripe endpoint
 *      regression test still requires this path.
 */

/** Minimal raw shape of the members row this module returns. */
export type MemberAuthRow = {
  id: string;
  slug: string;
  user_id: string | null;
};

// ── Path safety ───────────────────────────────────────────────────────

/**
 * Returns true iff `next` is safe to redirect to inside the app.
 * Rejects external URLs, protocol-relative URLs, and the auth
 * surfaces themselves (which would loop). Used by /auth/callback,
 * the login form, and the claim action.
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/login")) return false;
  if (next.startsWith("/auth")) return false;
  return true;
}

// ── Client helpers ────────────────────────────────────────────────────

export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseBrowserAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function requireMemberAccess(
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const client = getSupabaseBrowserAuthClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}

// ── Server (cookie) helpers ───────────────────────────────────────────

export async function getCurrentUserFromCookies(): Promise<User | null> {
  const client = await getSupabaseServerAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function requireMemberAccessFromCookies(
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const client = await getSupabaseServerAuthClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}

// ── Server (Bearer token) helpers — kept stable for Stripe API ────────

function bearerFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Validates a Bearer access token from the request. Used by API
 * route handlers that the browser hits cross-origin via fetch (i.e.
 * /api/stripe/create-checkout-session).
 */
export async function getCurrentUserFromRequest(
  req: Request,
): Promise<User | null> {
  const token = bearerFromRequest(req);
  if (!token) return null;
  // Use the non-auth client deliberately: we're validating an
  // explicit token, not reading the SSR cookie session.
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

export async function requireMemberAccessForRequest(
  req: Request,
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  const { data: member } = await client
    .from("members")
    .select("id, slug, user_id")
    .eq("slug", slug)
    .single();
  if (!member || member.user_id !== user.id) return null;
  return member as MemberAuthRow;
}
