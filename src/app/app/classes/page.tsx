"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import type { StudioClass } from "./data";
import {
  reconcileClass,
  type ReconciliationSummary,
  type ReconciliationTone,
} from "./reconciliation";

/**
 * v0.8.5: compact list-level indicator. Pulls the headline from the
 * reconciliation summary and colour-codes it by tone. We deliberately
 * only surface the indicator when it says something actionable:
 *
 *   - alert / watch: always shown — these are the ones the operator
 *     needs to see when scanning the list.
 *   - good: shown for completed classes where a strong outcome is
 *     informative, and for upcoming classes at fully-booked so the
 *     operator knows capacity is gone.
 *   - neutral: suppressed to keep the list quiet.
 */
const TONE_PILL: Record<ReconciliationTone, string> = {
  good: "border-green-400/30 text-green-300/90",
  neutral: "border-white/15 text-white/50",
  watch: "border-amber-400/30 text-amber-300/90",
  alert: "border-red-400/30 text-red-300/90",
};

function shouldShowPill(
  summary: ReconciliationSummary,
  lifecycle: StudioClass["lifecycle"],
): boolean {
  if (summary.tone === "alert" || summary.tone === "watch") return true;
  // For "good" tones, only surface the ones an operator cares about at
  // a glance: completed-class positive outcomes and fully-booked
  // upcoming classes. Everything else is noise.
  if (summary.tone === "good") {
    if (lifecycle === "completed") return true;
    if (summary.signals.some((s) => s.label === "Fully booked")) return true;
  }
  return false;
}

function ListSignalPill({ summary }: { summary: ReconciliationSummary }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE_PILL[summary.tone]}`}
      title={summary.interpretation}
    >
      {summary.headline}
    </span>
  );
}

function ClassCard({ cls, muted }: { cls: StudioClass; muted?: boolean }) {
  const isFull = cls.booked >= cls.capacity;
  const isUpcoming = cls.lifecycle === "upcoming";
  const summary = reconcileClass(cls);
  const pillVisible = shouldShowPill(summary, cls.lifecycle);
  return (
    <li>
      <Link
        href={`/app/classes/${cls.id}`}
        className={`flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
          muted
            ? "border-white/5 hover:border-white/15"
            : "border-white/10 hover:border-white/25"
        }`}
      >
        <div className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${muted ? "text-white/50" : ""}`}>
            {cls.name}
          </span>
          <span className={`text-xs ${muted ? "text-white/30" : "text-white/50"}`}>
            {cls.time} &middot; {cls.instructor}
          </span>
          {isUpcoming && cls.cancellationWindowClosed !== undefined && (
            <span
              className={`text-xs ${
                cls.cancellationWindowClosed
                  ? "text-amber-400/80"
                  : "text-white/30"
              }`}
            >
              {cls.cancellationWindowClosed
                ? "Cancellation window closed"
                : "Free cancellation open"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pillVisible && <ListSignalPill summary={summary} />}
          <span
            className={`text-xs ${
              isFull ? (muted ? "text-green-400/50" : "text-green-400") : muted ? "text-white/30" : "text-white/50"
            }`}
          >
            {cls.booked}/{cls.capacity} booked
            {cls.waitlistCount > 0 && (
              <span className={muted ? "text-white/20" : "text-white/40"}>
                {" "}&middot; {cls.waitlistCount} on waitlist
              </span>
            )}
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function ClassesPage() {
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
        <p className="text-red-400 text-sm">Failed to load data. Check configuration.</p>
        <p className="text-white/30 text-xs mt-2">{error}</p>
      </main>
    );
  }

  const liveClasses = classes.filter((c) => c.lifecycle === "live");
  const upcoming = classes.filter((c) => c.lifecycle === "upcoming");
  const completed = classes.filter((c) => c.lifecycle === "completed");

  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add class
        </button>
      </div>

      {/* Live */}
      {liveClasses.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-medium text-green-400">Live now</h2>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {liveClasses.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </ul>
        </section>
      )}

      {/* Upcoming */}
      <section className={liveClasses.length > 0 ? "mt-8" : "mt-6"}>
        <h2 className="text-sm font-medium text-white/70">Upcoming</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {upcoming.map((cls) => (
            <ClassCard key={cls.id} cls={cls} />
          ))}
        </ul>
      </section>

      {/* Completed */}
      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-white/40">Completed</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {completed.map((cls) => (
              <ClassCard key={cls.id} cls={cls} muted />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
