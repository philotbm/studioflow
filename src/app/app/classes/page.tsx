"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { StudioClass } from "./data";
import {
  reconcileClass,
  type ReconciliationSummary,
  type ReconciliationTone,
} from "./reconciliation";

// v0.8.6: minimal list filter modes. "all" keeps the existing
// live / upcoming / completed sectioning; "needs_attention" flattens
// to a single sorted list of watch + alert classes only.
type FilterMode = "all" | "needs_attention";

function needsAttention(summary: ReconciliationSummary | null): boolean {
  return summary?.tone === "watch" || summary?.tone === "alert";
}

/** alert before watch; stable within same tone. */
function severityRank(tone: ReconciliationTone | undefined): number {
  return tone === "alert" ? 0 : tone === "watch" ? 1 : 2;
}

function summarise(cls: StudioClass): ReconciliationSummary | null {
  try {
    return reconcileClass(cls);
  } catch {
    return null;
  }
}

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

function ClassCard({
  cls,
  muted,
  summary: summaryOverride,
  lifecycle,
}: {
  cls: StudioClass;
  muted?: boolean;
  /** v0.8.6: pre-computed summary from the parent (filter-mode path)
   *  so we don't re-derive per card. Falls back to a local derivation
   *  for callers that don't pass one. */
  summary?: ReconciliationSummary | null;
  /** v0.8.6.1: when present, renders a small "Live / Upcoming / Completed"
   *  context label before the class title. Only passed from the
   *  Needs-attention branch — the default sectioned "Show all" view
   *  leaves this undefined so the label does not appear there. */
  lifecycle?: "live" | "upcoming" | "completed";
}) {
  const isFull = cls.booked >= cls.capacity;
  const isUpcoming = cls.lifecycle === "upcoming";
  const summary =
    summaryOverride !== undefined ? summaryOverride : summarise(cls);
  const pillVisible = summary !== null && shouldShowPill(summary, cls.lifecycle);
  const lifecycleLabel =
    lifecycle === "live"
      ? "Live"
      : lifecycle === "upcoming"
        ? "Upcoming"
        : lifecycle === "completed"
          ? "Completed"
          : null;
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
            {lifecycleLabel && (
              <span className="mr-2 text-xs font-normal text-white/40">
                {lifecycleLabel}
              </span>
            )}
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
          {pillVisible && summary && <ListSignalPill summary={summary} />}
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
  const [filter, setFilter] = useState<FilterMode>("all");

  // v0.8.6: reconcile once per class for the filter / count / sort
  // pass. ClassCard receives the pre-computed summary so we don't
  // re-derive per card. The try/catch lives inside `summarise` so a
  // single bad row can never break this pass.
  const reconciled = useMemo(
    () =>
      classes.map((cls) => ({
        cls,
        summary: summarise(cls),
      })),
    [classes],
  );

  const attentionCount = useMemo(
    () => reconciled.filter((r) => needsAttention(r.summary)).length,
    [reconciled],
  );

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

  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add class
        </button>
      </div>

      {/* v0.8.6 filter toggle */}
      <div
        className="mt-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Class list filter"
      >
        <button
          type="button"
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={`rounded border px-3 py-1 text-xs transition-colors ${
            filter === "all"
              ? "border-white/40 bg-white/10 text-white"
              : "border-white/15 text-white/60 hover:text-white hover:border-white/30"
          }`}
        >
          Show all
        </button>
        <button
          type="button"
          onClick={() => setFilter("needs_attention")}
          aria-pressed={filter === "needs_attention"}
          disabled={attentionCount === 0 && filter !== "needs_attention"}
          className={`rounded border px-3 py-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            filter === "needs_attention"
              ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
              : "border-white/15 text-white/60 hover:text-white hover:border-white/30"
          }`}
        >
          Needs attention ({attentionCount})
        </button>
      </div>

      {filter === "needs_attention"
        ? renderNeedsAttention(reconciled)
        : renderAllSections(reconciled)}
    </main>
  );
}

/** v0.8.6 "Show all" render — preserves the v0.8.5 sectioning verbatim. */
function renderAllSections(
  reconciled: Array<{ cls: StudioClass; summary: ReconciliationSummary | null }>,
) {
  const live = reconciled.filter((r) => r.cls.lifecycle === "live");
  const upcoming = reconciled.filter((r) => r.cls.lifecycle === "upcoming");
  const completed = reconciled.filter((r) => r.cls.lifecycle === "completed");

  return (
    <>
      {live.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-medium text-green-400">Live now</h2>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {live.map(({ cls, summary }) => (
              <ClassCard key={cls.id} cls={cls} summary={summary} />
            ))}
          </ul>
        </section>
      )}

      <section className={live.length > 0 ? "mt-8" : "mt-6"}>
        <h2 className="text-sm font-medium text-white/70">Upcoming</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {upcoming.map(({ cls, summary }) => (
            <ClassCard key={cls.id} cls={cls} summary={summary} />
          ))}
        </ul>
      </section>

      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-white/40">Completed</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {completed.map(({ cls, summary }) => (
              <ClassCard key={cls.id} cls={cls} summary={summary} muted />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** v0.8.6 "Needs attention" render — flat list sorted alert-first,
 *  watch-second, original order preserved within a tone (sort is stable). */
function renderNeedsAttention(
  reconciled: Array<{ cls: StudioClass; summary: ReconciliationSummary | null }>,
) {
  const filtered = reconciled.filter((r) => needsAttention(r.summary));
  const sorted = [...filtered].sort(
    (a, b) => severityRank(a.summary?.tone) - severityRank(b.summary?.tone),
  );

  if (sorted.length === 0) {
    return (
      <section className="mt-6 rounded border border-white/10 px-4 py-6 text-center text-sm text-white/50">
        Nothing needs attention — every class is healthy or neutral.
      </section>
    );
  }

  return (
    <section className="mt-6">
      <ul className="flex flex-col gap-3">
        {sorted.map(({ cls, summary }) => (
          <ClassCard
            key={cls.id}
            cls={cls}
            summary={summary}
            muted={cls.lifecycle === "completed"}
            // v0.8.6.1: only in the Needs-attention branch we surface a
            // context label ahead of the class name, because the flat
            // sorted list drops the Live / Upcoming / Completed section
            // headings the default view provides.
            lifecycle={cls.lifecycle}
          />
        ))}
      </ul>
    </section>
  );
}
