"use client";

import Link from "next/link";
import { qaFixtureFor } from "@/lib/db";

/**
 * Small banner that renders only on the qa-* fixture pages, so testers
 * can see at a glance which scenario a URL is demonstrating. Invisible
 * on every production class page — production surfaces remain clean.
 *
 * When `missing` is true (v0.8.4.2), the banner switches to a red
 * QA-environment error state explaining the fixture row isn't in the
 * DB yet and linking to the /qa landing page where the refresh runs.
 */
export default function QaFixtureBanner({
  classSlug,
  missing = false,
}: {
  classSlug: string;
  missing?: boolean;
}) {
  const fixture = qaFixtureFor(classSlug);
  if (!fixture) return null;

  if (missing) {
    return (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300/90">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-red-400/40 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              QA · {fixture.scenario} · not seeded
            </span>
            <span className="font-medium">{fixture.label}</span>
          </div>
          <span className="text-red-200/80">
            This QA fixture isn&apos;t in the database yet. Open /qa to
            self-activate the fixtures (one click) and then retry this URL.
          </span>
        </div>
        <Link
          href="/qa"
          className="shrink-0 rounded border border-red-400/40 px-2 py-0.5 text-[11px] hover:border-red-400/70"
        >
          Open QA matrix
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] uppercase tracking-wide">
            QA · {fixture.scenario}
          </span>
          <span className="font-medium">{fixture.label}</span>
        </div>
        <span className="text-amber-200/70">{fixture.description}</span>
      </div>
      <Link
        href="/qa"
        className="shrink-0 rounded border border-amber-400/30 px-2 py-0.5 text-[11px] hover:border-amber-400/60"
      >
        Back to QA matrix
      </Link>
    </div>
  );
}
