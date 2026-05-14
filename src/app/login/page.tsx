"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseBrowserAuthClient } from "@/lib/supabase";

/**
 * v0.20.0 / v0.20.1 Member login.
 *
 * Single email input → Supabase magic link with PKCE flow. The link
 * lands at /auth/callback?code=…&next=…, which runs the decision
 * tree (linked → /my/{slug}, un-claimed candidate → /auth/claim,
 * else → /login?error=no-member).
 *
 * `?next=<path>` is preserved through the round-trip via the
 * emailRedirectTo URL so the user lands where they originally tried
 * to go. The redirect URL must be in the Supabase Redirect URLs
 * allow-list (already configured for prod).
 *
 * `?error=no-member` is rendered when the callback finishes but no
 * candidate member row matches. v0.20.1 routes the
 * email-match-with-phone case through /auth/claim instead — only
 * truly unmatched users see this banner now.
 *
 * `?error=auth&reason=…` is rendered when the magic-link exchange
 * itself fails (expired link, replayed code, missing config).
 */

function LoginForm() {
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

  // If the user is already authenticated and lands here (e.g. clicked
  // /login from a stale tab), bounce them forward instead of asking for
  // their email again.
  useEffect(() => {
    let cancelled = false;
    const client = getSupabaseBrowserAuthClient();
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) {
        window.location.replace(next || "/");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [next]);

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
    // v0.23.3 — emailRedirectTo MUST land at /auth/callback.
    // See the matching comment in src/app/staff/login/page.tsx for the
    // full rationale. tl;dr: passing the bare origin (or anything that
    // doesn't include `/auth/callback`) makes Supabase deliver a magic
    // link whose target is the root page with a `?code=` param the
    // callback never gets to exchange — looks like "login is broken."
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) callbackUrl.searchParams.set("next", next);
    const { error: otpError } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl.toString() },
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
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-white/60">
        Enter your email and we&apos;ll send you a magic link.
      </p>

      {error === "no-member" && (
        <div
          role="alert"
          className="mt-6 rounded border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm text-amber-300"
        >
          You signed in, but we couldn&apos;t find a member profile for your
          email at any studio. Ask your studio to add you (with a phone
          number on file) and try again.
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
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in Next 16.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
