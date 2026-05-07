"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { requireMemberAccess, getCurrentUser } from "@/lib/auth";

/**
 * v0.20.0 / v0.20.1 client-side member access gate.
 *
 * Wraps every page under /my/{slug}/. Three terminal states:
 *
 *   pending   — checking, render a tiny placeholder.
 *   ok        — auth verified for this slug, render children.
 *   denied    — either no session (redirect to /login?next=...) or
 *               session exists but the user does not own this slug
 *               (render an inline 403 panel with sign-out link).
 *
 * v0.20.1: requireMemberAccess and getCurrentUser now read the
 * SSR-cookie session, so this gate sees the same session that
 * /auth/callback wrote. No structural change here — still a
 * client-side gate, still re-runs on slug change (per the Next.js
 * auth guide's partial-rendering note).
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

    void requireMemberAccess(slug).then(async (member) => {
      if (cancelled) return;

      if (member) {
        setState("ok");
        return;
      }

      // Distinguish "not signed in at all" from "signed in but not
      // your slug". Re-fetching the user is cheap (cached client-side)
      // and gives the right UX divergence: login redirect vs. 403.
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
        <div className="mt-6 flex items-center justify-center gap-4 text-xs">
          <Link href="/" className="text-white/40 hover:text-white/70">
            ← Back home
          </Link>
          <span className="text-white/20">·</span>
          <Link
            href="/auth/signout"
            className="text-white/40 hover:text-white/70"
          >
            Sign out
          </Link>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
