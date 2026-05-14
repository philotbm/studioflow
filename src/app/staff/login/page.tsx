"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseBrowserAuthClient } from "@/lib/supabase";
import { setLoginIntent } from "@/app/auth/actions";

/**
 * v0.21.0 Staff login.
 *
 * Mirrors /login (member) — single email input → Supabase magic link
 * with PKCE — but tags the callback with `intent=staff` so the
 * /auth/callback decision tree resolves the staff row instead of
 * member rows.
 *
 * Differences from /login on purpose:
 *
 *   - Page title and copy say "Staff sign in".
 *   - emailRedirectTo carries `intent=staff`.
 *   - Default `next` is `/app` (not `/`).
 *   - We deliberately DO NOT auto-redirect when a session is
 *     already present. The proxy redirects un-authorised signed-in
 *     users HERE; auto-redirecting back to `next` would loop
 *     (proxy bounces non-staff → here → here bounces back → repeat).
 *     Showing the form unconditionally lets staff sign in, lets
 *     non-staff users see the not-authorised message, and lets
 *     anyone sign out via the link below if they're stuck.
 *
 * `?error=not-authorised` is rendered when /auth/callback resolved a
 * staff intent for a user with no staff row, OR when the proxy
 * blocked a signed-in non-staff user from a /app or /api/admin
 * surface (the latter only applies to page paths).
 */

function StaffLoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const error = searchParams.get("error");
  const errorReason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent"; email: string }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    const client = getSupabaseBrowserAuthClient();
    if (!client) {
      setStatus({
        kind: "error",
        text: "Auth not configured. Check NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.",
      });
      return;
    }
    setStatus({ kind: "sending" });
    // v0.23.4 — Intent + next ride in a server-set HttpOnly cookie, not
    // on the emailRedirectTo query string.
    //
    // Background: Supabase's redirect-URL allow-list is a strict prefix
    // match. v0.23.3's emailRedirectTo (`${origin}/auth/callback?intent=…&next=…`)
    // didn't match the strict entry `${origin}/auth/callback`, so Supabase
    // silently fell back to Site URL and the magic link landed at
    // `${origin}/?code=…`. The 2026-05-14 interim fix added three
    // wildcard allow-list entries; v0.23.4 reverts to strict matching
    // by stripping the query string here and moving intent+next into a
    // separate cookie set by the setLoginIntent server action.
    //
    // emailRedirectTo is now EXACTLY `${origin}/auth/callback` — no
    // query params, no path suffix. Matches the strict allow-list.
    await setLoginIntent({ intent: "staff", next: next || "/app" });
    const emailRedirectTo = new URL(
      "/auth/callback",
      window.location.origin,
    ).toString();
    const { error: otpError } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });
    if (otpError) {
      setStatus({ kind: "error", text: otpError.message });
      return;
    }
    setStatus({ kind: "sent", email });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12 text-white">
      <Link
        href="/"
        className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
      >
        StudioFlow
      </Link>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-white/60">
        Enter your email and we&apos;ll send you a magic link.
      </p>

      {error === "not-authorised" && (
        <div
          role="alert"
          className="mt-6 rounded border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm text-amber-300"
        >
          This email isn&apos;t registered as studio staff. Contact your
          studio owner if you think this is wrong.
        </div>
      )}
      {error === "auth" && (
        <div
          role="alert"
          className="mt-6 rounded border border-red-400/40 bg-red-400/5 px-4 py-3 text-sm text-red-300"
        >
          Sign-in failed
          {errorReason ? ` — ${errorReason}` : ""}. Try requesting a new
          magic link.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <label htmlFor="email" className="text-xs text-white/60">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status.kind === "sending" || status.kind === "sent"}
          className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm focus:border-white/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={
            !email || status.kind === "sending" || status.kind === "sent"
          }
          className="mt-1 rounded border border-white/30 px-3 py-2 text-sm hover:border-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {status.kind === "sending" ? "Sending…" : "Send magic link"}
        </button>
      </form>

      {status.kind === "sent" && (
        <p
          role="status"
          className="mt-4 rounded border border-green-400/30 px-4 py-3 text-sm text-green-400"
        >
          Magic link sent to {status.email}. Check your inbox.
        </p>
      )}
      {status.kind === "error" && (
        <p
          role="alert"
          className="mt-4 rounded border border-red-400/40 px-4 py-3 text-sm text-red-400"
        >
          {status.text}
        </p>
      )}

      <p className="mt-8 text-xs text-white/40">
        Member sign-in is at{" "}
        <Link href="/login" className="underline hover:text-white/70">
          /login
        </Link>
        .
      </p>
    </main>
  );
}

export default function StaffLoginPage() {
  // useSearchParams requires a Suspense boundary in Next 16.
  return (
    <Suspense fallback={null}>
      <StaffLoginForm />
    </Suspense>
  );
}
