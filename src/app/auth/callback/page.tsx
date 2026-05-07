"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.20.0 Magic-link callback.
 *
 * The browser arrives here with either a `?code=...` (PKCE) or a
 * fragment-style `#access_token=...` URL after clicking the magic
 * link in their email. supabase-js handles both:
 *
 *   - PKCE: we explicitly call exchangeCodeForSession(code) using the
 *     code verifier stashed in localStorage at signInWithOtp time.
 *   - Implicit: detectSessionInUrl (default true) parses the fragment
 *     during the next auth call.
 *
 * Once a session exists, we look up the matching members row by
 * user_id and redirect to /my/{slug} (or to the original `next` path
 * if it was a deep link). No claim → /login?error=no-member.
 *
 * Implemented as a client page rather than a Route Handler because
 * supabase-js without @supabase/ssr expects the exchange to happen in
 * the browser where the code verifier lives. M1 is dependency-free.
 */

function CallbackInner() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (errorDescription) {
        if (!cancelled) setMessage(errorDescription);
        return;
      }

      const client = getSupabaseClient();
      if (!client) {
        if (!cancelled) {
          setMessage(
            "Auth not configured. Check NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.",
          );
        }
        return;
      }

      // PKCE path. exchangeCodeForSession reads the code verifier from
      // storage, calls Supabase, and persists the resulting session.
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
          if (!cancelled) setMessage(error.message);
          return;
        }
      }

      const { data: userData } = await client.auth.getUser();
      const user = userData.user;
      if (!user) {
        if (!cancelled) {
          window.location.replace(
            `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`,
          );
        }
        return;
      }

      // Honour an explicit deep link if there is one. Otherwise
      // resolve the user's claimed member slug and land them on /my.
      if (next) {
        window.location.replace(next);
        return;
      }

      const { data: member } = await client
        .from("members")
        .select("slug")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!member) {
        window.location.replace("/login?error=no-member");
        return;
      }
      window.location.replace(`/my/${member.slug}`);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, next, errorDescription]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-white">
      <p className="text-sm text-white/60">{message}</p>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
