"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requireMemberAccess } from "@/lib/auth";

/**
 * v0.20.0 client-side member access gate.
 *
 * Wraps every page under /my/{slug}/. Three terminal states:
 *
 *   pending   — checking, render a tiny placeholder.
 *   ok        — auth verified for this slug, render children.
 *   denied    — either no session (redirect to /login?next=...) or
 *               session exists but the user does not own this slug
 *               (render an inline 403 panel).
 *
 * Why client-side: M1 ships with no SSR cookie integration (no
 * @supabase/ssr dep). The same supabase-js client used in the rest of
 * the app reads the session from localStorage in the browser. A
 * future M2/M3 swap to cookie-backed sessions can move this gate to
 * the server without changing the page surface.
 *
 * The Next.js auth guide flags that layouts don't re-run on
 * navigation between dynamic-param siblings — so we re-check whenever
 * `slug` changes, not just on mount.
 */
export function MemberAccessGate({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"pending" | "ok" | "forbidden">(
    "pending",
  );

  useEffect(() => {
    let cancelled = false;
    setState("pending");

    void requireMemberAccess(slug).then(async (member) => {
      if (cancelled) return;

      if (member) {
        setState("ok");
        return;
      }

      // Distinguish "not signed in at all" from "signed in but not
      // your slug". Re-fetching the user is cheap (cached client-side)
      // and gives the right UX divergence: login redirect vs. 403.
      const { getCurrentUser } = await import("@/lib/auth");
      const user = await getCurrentUser();
      if (cancelled) return;

      if (!user) {
        const next = encodeURIComponent(window.location.pathname);
        window.location.replace(`/login?next=${next}`);
        return;
      }

      setState("forbidden");
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state === "pending") {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading…</p>
      </main>
    );
  }

  if (state === "forbidden") {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <h1 className="text-lg font-medium">Not your page</h1>
        <p className="mt-2 text-sm text-white/60">
          You&apos;re signed in, but this isn&apos;t your member account.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-xs text-white/40 hover:text-white/70"
        >
          ← Back home
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}
