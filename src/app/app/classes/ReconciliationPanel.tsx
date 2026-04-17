"use client";

import type {
  ReconciliationSummary,
  ReconciliationTone,
} from "./reconciliation";
import { formatPct } from "./reconciliation";

/**
 * v0.8.5 reconciliation panel. Used by the operator class-detail page
 * and (optionally) the instructor view. Renders:
 *
 *   - a tone-coloured headline + one-sentence interpretation
 *   - the relevant counts (checked-in / no-show / late-cancel / pending)
 *   - the relevant ratios (attendance rate on completed, fill rate on
 *     upcoming)
 *   - every signal as a small pill, worst tone first
 *
 * Every value comes straight out of reconcileClass — there is no
 * additional business logic in here.
 */

const TONE_HEADLINE: Record<ReconciliationTone, string> = {
  good: "text-green-300",
  neutral: "text-white/80",
  watch: "text-amber-300",
  alert: "text-red-300",
};

const TONE_BORDER: Record<ReconciliationTone, string> = {
  good: "border-green-400/30 bg-green-400/5",
  neutral: "border-white/15 bg-white/5",
  watch: "border-amber-400/30 bg-amber-400/5",
  alert: "border-red-400/30 bg-red-400/5",
};

const PILL_TONE: Record<ReconciliationTone, string> = {
  good: "border-green-400/30 text-green-300/90",
  neutral: "border-white/20 text-white/60",
  watch: "border-amber-400/30 text-amber-300/90",
  alert: "border-red-400/30 text-red-300/90",
};

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "neutral" | "watch" | "alert";
}) {
  const valueTone =
    tone === "good"
      ? "text-green-300"
      : tone === "watch"
        ? "text-amber-300"
        : tone === "alert"
          ? "text-red-300"
          : "text-white/80";
  return (
    <div className="rounded border border-white/10 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-white/40">
        {label}
      </span>
      <p className={`mt-0.5 text-base font-semibold ${valueTone}`}>{value}</p>
    </div>
  );
}

export default function ReconciliationPanel({
  summary,
  lifecycle,
}: {
  summary: ReconciliationSummary;
  lifecycle: "upcoming" | "live" | "completed";
}) {
  const showAttendance = lifecycle !== "upcoming";
  const showFill = lifecycle !== "live";

  return (
    <section
      className={`mt-6 rounded-lg border px-4 py-4 ${TONE_BORDER[summary.tone]}`}
      aria-label="Class reconciliation summary"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`text-sm font-semibold ${TONE_HEADLINE[summary.tone]}`}>
          {summary.headline}
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-white/40">
          Reconciliation · {lifecycle}
        </span>
      </div>
      <p className="mt-1 text-sm text-white/70">{summary.interpretation}</p>

      {summary.signals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.signals.map((s, i) => (
            <span
              key={i}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${PILL_TONE[s.tone]}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Checked in"
          value={String(summary.checkedInCount)}
          tone={summary.checkedInCount > 0 ? "good" : "neutral"}
        />
        <Stat
          label="No-show"
          value={String(summary.noShowCount)}
          tone={summary.noShowCount > 0 ? "alert" : "neutral"}
        />
        <Stat
          label="Late cancel"
          value={String(summary.lateCancelCount)}
          tone={summary.lateCancelCount > 0 ? "watch" : "neutral"}
        />
        {lifecycle === "completed" ? (
          <Stat
            label="Attendance rate"
            value={formatPct(summary.attendanceRate)}
            tone={
              summary.attendanceRate === null
                ? "neutral"
                : summary.attendanceRate >= 0.75
                  ? "good"
                  : summary.attendanceRate >= 0.5
                    ? "watch"
                    : "alert"
            }
          />
        ) : (
          <Stat
            label="Pending"
            value={String(summary.pendingCount)}
            tone="neutral"
          />
        )}
      </div>

      {(showAttendance || showFill) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
          {showFill && (
            <span>
              Fill rate:{" "}
              <span className="text-white/70">
                {formatPct(summary.fillRate)}
              </span>
              {" "}({summary.plannedCount}/{summary.capacity})
            </span>
          )}
          {lifecycle === "completed" && summary.noShowRate !== null && (
            <span>
              No-show rate:{" "}
              <span className="text-white/70">
                {formatPct(summary.noShowRate)}
              </span>
            </span>
          )}
          {summary.lateCancelShare !== null &&
            summary.lateCancelCount > 0 && (
              <span>
                Late-cancel share:{" "}
                <span className="text-white/70">
                  {formatPct(summary.lateCancelShare)}
                </span>
              </span>
            )}
          {summary.waitlistCount > 0 && (
            <span>
              Waitlist:{" "}
              <span className="text-white/70">{summary.waitlistCount}</span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
