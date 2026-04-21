"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { summariseMembership, accessTypeLabel } from "@/lib/memberships";

/**
 * v0.10.0 member-facing landing page.
 *
 * There is no auth system in this phase, so this page offers a simple
 * picker: pick which member you are, we send you to /book/{slug}.
 * Intended for the v0.10.0 demo / QA loop. In a real product this
 * is where magic-link-from-email or session-auth would land.
 *
 * The member list is read straight from the shared store — it's the
 * same list the operator surface uses. Members on drop-in / walk-in
 * plans are filtered out here only because fetchAllMembers already
 * excludes them server-side; we don't add a second filter.
 */
export default function BookLandingPage() {
  const { members, loading, error } = useStore();

  if (loading) {
    return (
      <main className="mx-auto max-w-xl pt-12 text-center">
        <p className="text-white/40">Loading…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-xl pt-12 text-center">
        <p className="text-red-400 text-sm">Failed to load data.</p>
        <p className="text-white/30 text-xs mt-2">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Welcome to StudioFlow</h1>
      <p className="mt-2 text-sm text-white/60">
        Pick your name to see your upcoming classes and book new ones.
      </p>
      <p className="mt-2 text-xs text-white/30">
        This is the member surface — see upcoming classes, book, join
        waitlists, and cancel. Your booking rule is the same as the
        studio uses: unlimited or positive credits.
      </p>

      <ul className="mt-8 flex flex-col gap-2">
        {members.map((m) => {
          const summary = summariseMembership(m);
          return (
            <li key={m.id}>
              <Link
                href={`/book/${m.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-3 hover:border-white/25"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-white/50">
                    {accessTypeLabel(summary)} · {summary.summaryLine.split("·").slice(1).join("·").trim() || summary.summaryLine}
                  </span>
                </div>
                <span className="text-xs text-white/40">Continue →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
