/**
 * v0.23.4 — Login-intent cookie carrier.
 *
 * Carries `intent` (staff | member) and `next` (post-login redirect)
 * from the login form to /auth/callback via a short-lived HttpOnly
 * cookie instead of via query params on `emailRedirectTo`.
 *
 * Why a cookie and not query params:
 *
 * Supabase's redirect-URL allow-list does a strict prefix match. When
 * the login form passed `emailRedirectTo = ${origin}/auth/callback?intent=staff&next=/app`,
 * the strict entry `https://studioflow.ie/auth/callback` in the allow-list
 * didn't match (because of the query string), so Supabase fell back to
 * Site URL and the magic link landed at `/?code=…` instead of
 * `/auth/callback?code=…`. The interim fix on 2026-05-14 added three
 * wildcard entries to the allow-list (`…/auth/callback?**`). The
 * wildcards work but loosen the security posture: any query string on
 * the callback path is now accepted, including attacker-controlled ones.
 *
 * v0.23.4 closes that hole. emailRedirectTo is now exactly
 * `${origin}/auth/callback` (matches the strict allow-list entry).
 * `intent` and `next` ride along in a separate HttpOnly cookie set by
 * the form-submit server action right before signInWithOtp fires.
 * /auth/callback reads and clears the cookie after the PKCE exchange.
 *
 * Cookie format: base64url(JSON({ intent, next, exp })). Plaintext
 * (no HMAC) because the cookie is HttpOnly — a cross-origin script
 * cannot set or read it, so the only attacker who could tamper with
 * the value is one who already controls the server. `intent` is
 * validated against the allowed set and `next` is path-only-checked,
 * so a malicious value is bounded to "wrong dashboard" or "no-op next."
 *
 * TTL is 10 minutes — long enough for a user to click the magic link
 * in a typical email read flow, short enough that a stale intent
 * doesn't survive across an abandoned session.
 *
 * Cross-device limitation: cookies don't transfer between browsers.
 * If a user submits the form on device A and clicks the magic link
 * on device B, the callback won't find the cookie and will fall back
 * to the current staff-first default (`/app` for staff, member
 * resolution otherwise). Acceptable degradation; documented in
 * docs/specs/auth_regression_fix.md.
 */

export type LoginIntentValue = "staff" | "member";

export interface LoginIntent {
  intent: LoginIntentValue;
  next: string | null;
}

interface StoredLoginIntent extends LoginIntent {
  /** Epoch milliseconds at which the intent expires. */
  exp: number;
}

/** Cookie name written by the form submit and read by /auth/callback. */
export const LOGIN_INTENT_COOKIE = "sf_login_intent";

/** Cookie TTL in seconds. */
export const LOGIN_INTENT_TTL_SECONDS = 10 * 60;

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  // Re-pad to a length divisible by 4 before decoding.
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
}

/**
 * Returns true iff `next` is safe to embed in the cookie.
 *
 * The callback's existing isSafeNextPath does the redirect-time safety
 * filter, but we validate at write time too: garbage input never reaches
 * the cookie, and a tampered cookie at read time fails the same check.
 *
 * Internal-paths only; nothing protocol-relative or external. Empty
 * string and null both encode as "no next" (caller chooses default).
 */
function isStorableNextPath(next: unknown): next is string {
  if (typeof next !== "string") return false;
  if (next.length === 0) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  return true;
}

function isValidIntent(value: unknown): value is LoginIntentValue {
  return value === "staff" || value === "member";
}

/**
 * Encode an intent + next for cookie storage. Returns a base64url
 * string. Throws if intent is invalid; caller should construct valid
 * inputs (the server action does, and TypeScript narrows the type).
 */
export function encodeLoginIntent(intent: LoginIntent): string {
  if (!isValidIntent(intent.intent)) {
    throw new Error(`Invalid login intent: ${String(intent.intent)}`);
  }
  const stored: StoredLoginIntent = {
    intent: intent.intent,
    next: isStorableNextPath(intent.next) ? intent.next : null,
    exp: Date.now() + LOGIN_INTENT_TTL_SECONDS * 1000,
  };
  return base64urlEncode(JSON.stringify(stored));
}

/**
 * Decode a cookie value back to LoginIntent. Returns null on any of:
 *   - missing / empty input
 *   - malformed base64 or JSON
 *   - schema-invalid contents (unexpected intent, malformed next)
 *   - expired exp timestamp
 *
 * Callers treat null as "no intent set" and fall back to a sensible
 * default rather than surfacing the error to the user.
 */
export function decodeLoginIntent(raw: string | undefined | null): LoginIntent | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  if (!isValidIntent(record.intent)) return null;

  const exp = record.exp;
  if (typeof exp !== "number" || exp <= Date.now()) return null;

  const next = isStorableNextPath(record.next) ? record.next : null;

  return { intent: record.intent, next };
}
