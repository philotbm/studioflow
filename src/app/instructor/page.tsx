"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";

/**
 * v0.8.2 — Instructor landing page. Not in scope for the release per se,
 * but the /instructor route needs to render something if someone visits
 * it directly. Shows the list of upcoming + live classes linking to
 * /instructor/classes/[id]. Completed classes are hidden here to keep
 * the surface focused on classes an instructor is about to run.
 */
export default function InstructorIndex() {
  const { classes, loading, error } = useStore();

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading classes...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-sm text-red-400">Failed to load classes.</p>
        <p className="mt-2 text-xs text-white/30">{error}</p>
      </main>
    );
  }

  const runnable = classes
    .filter((c) => c.lifecycle === "live" || c.lifecycle === "upcoming")
    .sort((a, b) => {
      // Live first, then upcoming in their existing order
      if (a.lifecycle === b.lifecycle) return 0;
      return a.lifecycle === "live" ? -1 : 1;
    });

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Your classes</h1>
      <p className="mt-2 text-xs text-white/40">
        Select a class to mark attendance.
      </p>

      {runnable.length === 0 ? (
        <p className="mt-6 text-sm text-white/40">
          No live or upcoming classes right now.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {runnable.map((c) => (
            <li key={c.id}>
              <Link
                href={`/instructor/classes/${c.id}`}
                className="flex flex-col gap-1 rounded-lg border border-white/10 px-4 py-3 hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-white/50">
                    {c.time} · {c.instructor}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-white/50">
                  {c.lifecycle === "live" && (
                    <span className="inline-flex items-center gap-1 text-green-400">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                      Live
                    </span>
                  )}
                  <span>
                    {c.booked}/{c.capacity}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
