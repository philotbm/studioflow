import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserClient,
  createServerClient,
  type CookieOptions,
} from "@supabase/ssr";

/**
 * Three Supabase clients now coexist in this module — they aren't
 * interchangeable, and picking the wrong one for the wrong context
 * leads to silent auth bugs:
 *
 *   getSupabaseClient()          — anon, default storage. Used by
 *     every non-auth query (data fetches, server-to-server lookups in
 *     route handlers that authenticate via Bearer header). Same shape
 *     it has had since v0.4.8.
 *
 *   getSupabaseBrowserAuthClient() — anon + cookie storage + PKCE
 *     flow. The auth-aware client for client components: login form,
 *     /auth/callback (residual ref), member-access gate,
 *     member-home Buy button. Cookies are shared with the server
 *     client below so the server can read the same session.
 *
 *   getSupabaseServerAuthClient() — anon + cookie reading via
 *     next/headers. The auth-aware client for server components and
 *     route handlers (/auth/callback, /auth/claim, /auth/signout,
 *     and any future server surface that needs the session). Awaits
 *     cookies(); only callable from request scope.
 *
 * v0.20.1: PKCE flow type is set on the browser client so the magic
 * link arrives as `?code=...` and lands at /auth/callback (which
 * runs the decision tree). Without this, supabase-js falls back to
 * implicit flow (`#access_token=...`) and the callback never runs —
 * the bug that motivated this milestone.
 */

const URL_VAR = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_VAR = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// ── Default client (non-auth queries) ────────────────────────────────

let _client: SupabaseClient | null = null;
let _initAttempted = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (_initAttempted) return _client;
  _initAttempted = true;

  if (URL_VAR && ANON_VAR) {
    _client = createClient(URL_VAR, ANON_VAR);
  } else if (typeof window !== "undefined") {
    console.error(
      "[StudioFlow] Supabase env vars missing.",
      "NEXT_PUBLIC_SUPABASE_URL:", URL_VAR ? "set" : "EMPTY",
      "| NEXT_PUBLIC_SUPABASE_ANON_KEY:", ANON_VAR ? "set" : "EMPTY",
      "| If you just added env vars to Vercel, trigger a redeploy.",
    );
  }

  return _client;
}

// ── Browser auth client (client components) ──────────────────────────

let _browserAuthClient: SupabaseClient | null = null;

export function getSupabaseBrowserAuthClient(): SupabaseClient | null {
  if (_browserAuthClient) return _browserAuthClient;
  if (!URL_VAR || !ANON_VAR) return null;

  _browserAuthClient = createBrowserClient(URL_VAR, ANON_VAR, {
    auth: { flowType: "pkce" },
  });
  return _browserAuthClient;
}

// ── Server auth client (server components / route handlers) ──────────

/**
 * Cookies are async in Next 16. Only callable inside a request scope
 * (page render, route handler, server action) — calling at module
 * load time will throw.
 */
export async function getSupabaseServerAuthClient(): Promise<SupabaseClient | null> {
  if (!URL_VAR || !ANON_VAR) return null;
  // Lazy import to avoid pulling next/headers into client bundles
  // that import this module transitively.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createServerClient(URL_VAR, ANON_VAR, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll throws when called from a Server Component (cookies()
          // is read-only there). Route handlers and server actions
          // succeed. supabase/ssr's docs note this is expected; the
          // session refresh middleware (if any) handles the cookie
          // write later. M1.1 does not ship middleware — every place
          // we mutate the session (callback, signout, claim action) is
          // a route handler / server action where setAll succeeds.
        }
      },
    },
  });
}
