import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

/**
 * v0.20.0 Member auth helpers.
 *
 * The slug remains the public URL. The credential is auth.uid() linked
 * to members.user_id (see supabase/v0.20.0_migration.sql).
 *
 * Two access paths:
 *
 *   1. Client (React tree under /my, /login, /auth/callback): the
 *      shared supabase-js client persists the session in localStorage.
 *      `getCurrentUser()` and `requireMemberAccess(slug)` read from
 *      that. They return null on the server (no localStorage there).
 *
 *   2. Server (route handlers like /api/stripe/create-checkout-session):
 *      the client sends the access token in the Authorization header.
 *      `getCurrentUserFromRequest(req)` validates that token via the
 *      Supabase auth API. `requireMemberAccessForRequest(req, slug)`
 *      additionally checks members.user_id.
 *
 * Why no @supabase/ssr / cookie-backed session: M1 explicitly forbids
 * adding deps. SSR cookie integration arrives with M2/M3 when operator
 * auth ships and we accept the dependency.
 */

/** Minimal raw shape of the members row this module returns. */
export type MemberAuthRow = {
  id: string;
  slug: string;
  user_id: string | null;
};

// ── Client helpers ────────────────────────────────────────────────────

/**
 * Returns the authenticated user from the browser-side supabase-js
 * client. Server callers always get null — they should use
 * `getCurrentUserFromRequest` instead.
 */
export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

/**
 * Looks up a member by slug and confirms the current authenticated
 * user owns the row (members.user_id === auth.uid()). Returns the row
 * on success, null on missing / unauthenticated / forbidden — the
 * caller decides between login redirect and 403.
 *
 * Browser-only; server callers should use
 * `requireMemberAccessForRequest`.
 */
export async function requireMemberAccess(
  slug: string,
): Promise<MemberAuthRow | null> {
  const user = await getCurrentUser();
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

// ── Server helpers ────────────────────────────────────────────────────

function bearerFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Validates a Bearer access token from the request and returns the
 * authenticated user. Used by API route handlers — the client reads
 * its access token from `client.auth.getSession()` and forwards it
 * via `Authorization: Bearer <token>`.
 */
export async function getCurrentUserFromRequest(
  req: Request,
): Promise<User | null> {
  const token = bearerFromRequest(req);
  if (!token) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

/**
 * Server variant of requireMemberAccess. Validates the request's
 * Bearer token, then verifies the authenticated user owns the
 * members row found by slug.
 */
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
