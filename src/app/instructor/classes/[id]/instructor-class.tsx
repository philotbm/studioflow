"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Attendee } from "@/app/app/classes/data";
import type { AttendanceOutcome } from "@/lib/db";

/**
 * v0.8.2 Instructor View
 *
 * A deliberately narrow surface for running a class:
 *   - class name / time / instructor / booked-capacity
 *   - lifecycle badge (Upcoming / Live / Completed)
 *   - one row per BOOKED member (waitlist is excluded entirely)
 *   - Mark attended / Mark no-show buttons per row
 *   - state switching allowed for correction
 *
 * Lifecycle gate:
 *   - Upcoming  → buttons disabled, clear message
 *   - Live      → buttons active, DB writes allowed
 *   - Completed → read-only, shows final outcomes
 *
 * The DB (sf_mark_attendance) enforces the same lifecycle rule as a
 * backstop, so a stale tab cannot overwrite a finalised class.
 */

/**
 * Collapse the canonical Attendee status to the three instructor-facing
 * outcomes. late_cancel is an operator-side state and is excluded from
 * the instructor roster entirely. v0.8.2.1 unified the display
 * language across operator and instructor views — there is no
 * "checked_in" / "not_checked_in" layer to strip anymore, this mapper
 * only has to drop late_cancel.
 */
type InstructorStatus = "booked" | "attended" | "no_show";

function collapseToInstructorStatus(a: Attendee): InstructorStatus | null {
  switch (a.status) {
    case "booked":
      return "booked";
    case "attended":
      return "attended";
    case "no_show":
      return "no_show";
    case "late_cancel":
      return null; // excluded from the instructor list
  }
}

const STATUS_LABEL: Record<InstructorStatus, string> = {
  booked: "Booked",
  attended: "Attended",
  no_show: "No-show",
};

const STATUS_TONE: Record<InstructorStatus, string> = {
  booked: "text-white/60",
  attended: "text-green-400",
  no_show: "text-red-400",
};

const LIFECYCLE_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  live: "Live",
  completed: "Completed",
};

const LIFECYCLE_STYLE: Record<string, string> = {
  upcoming: "text-white/60 border-white/20",
  live: "text-green-400 border-green-400/30",
  completed: "text-white/40 border-white/10",
};

type AttendeeRowProps = {
  name: string;
  memberId?: string;
  status: InstructorStatus;
  editable: boolean;
  onMark: (memberId: string, outcome: AttendanceOutcome) => Promise<void>;
  busy: boolean;
};

function AttendeeRow({
  name,
  memberId,
  status,
  editable,
  onMark,
  busy,
}: AttendeeRowProps) {
  const canAct = editable && !busy && memberId !== undefined;
  return (
    <li className="flex flex-col gap-2 rounded border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className={`text-xs ${STATUS_TONE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      {editable ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => memberId && onMark(memberId, "attended")}
            disabled={!canAct}
            className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-30 ${
              status === "attended"
                ? "border-green-400/60 bg-green-400/10 text-green-300"
                : "border-white/20 text-white/70 hover:border-green-400/40 hover:text-green-300"
            }`}
            aria-pressed={status === "attended"}
          >
            {status === "attended" ? "Attended ✓" : "Mark attended"}
          </button>
          <button
            onClick={() => memberId && onMark(memberId, "no_show")}
            disabled={!canAct}
            className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-30 ${
              status === "no_show"
                ? "border-red-400/60 bg-red-400/10 text-red-300"
                : "border-white/20 text-white/70 hover:border-red-400/40 hover:text-red-300"
            }`}
            aria-pressed={status === "no_show"}
          >
            {status === "no_show" ? "No-show ✓" : "Mark no-show"}
          </button>
          {status !== "booked" && canAct && (
            <button
              onClick={() => memberId && onMark(memberId, "booked")}
              disabled={!canAct}
              className="text-xs text-white/30 underline-offset-2 hover:text-white hover:underline"
              title="Revert back to booked (mistake correction)"
            >
              Undo
            </button>
          )}
        </div>
      ) : (
        <span className="text-xs text-white/40">
          {/* Read-only view — no buttons at all */}
          {STATUS_LABEL[status]}
        </span>
      )}
    </li>
  );
}

export default function InstructorClass({ id }: { id: string }) {
  const { getClass, markAttendance, loading } = useStore();
  const cls = getClass(id);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading && !cls) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading class...</p>
      </main>
    );
  }

  if (!cls) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Class not found.</p>
        <Link
          href="/instructor"
          className="mt-4 inline-block text-xs text-white/40 hover:text-white/70"
        >
          &larr; Back
        </Link>
      </main>
    );
  }

  // Collapse to instructor-relevant statuses and drop late_cancel.
  type InstructorAttendee = {
    name: string;
    memberId?: string;
    status: InstructorStatus;
  };
  const attendees: InstructorAttendee[] = [];
  for (const a of cls.attendees) {
    const s = collapseToInstructorStatus(a);
    if (s === null) continue;
    attendees.push({ name: a.name, memberId: a.memberId, status: s });
  }

  const editable = cls.lifecycle === "live";
  const attendedCount = attendees.filter((a) => a.status === "attended").length;
  const noShowCount = attendees.filter((a) => a.status === "no_show").length;
  const pendingCount = attendees.filter((a) => a.status === "booked").length;

  async function handleMark(memberSlug: string, outcome: AttendanceOutcome) {
    setBusySlug(memberSlug);
    setError(null);
    try {
      await markAttendance(cls!.id, memberSlug, outcome);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark attendance");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href={`/app/classes/${cls.id}`}
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to operator view
      </Link>

      <div className="mt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{cls.name}</h1>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${LIFECYCLE_STYLE[cls.lifecycle]}`}
          >
            {cls.lifecycle === "live" && (
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            )}
            {LIFECYCLE_LABEL[cls.lifecycle]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/50">
          <span>{cls.time}</span>
          <span>{cls.instructor}</span>
          <span>
            {attendees.length}/{cls.capacity} booked
          </span>
        </div>
      </div>

      {/* Lifecycle guidance */}
      {cls.lifecycle === "upcoming" && (
        <div className="mt-6 rounded border border-white/10 px-4 py-3 text-xs text-white/50">
          Class has not started yet — attendance marking will unlock once the
          class goes live.
        </div>
      )}
      {cls.lifecycle === "completed" && (
        <div className="mt-6 rounded border border-white/10 px-4 py-3 text-xs text-white/50">
          Class is completed — attendance is read-only.
        </div>
      )}

      {/* Summary counters */}
      {editable && (
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Attended</span>
            <p className="text-lg font-semibold text-green-400">{attendedCount}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">No-show</span>
            <p className="text-lg font-semibold text-red-400">{noShowCount}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Pending</span>
            <p className="text-lg font-semibold text-white/60">{pendingCount}</p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-white/70">Attendees</h2>
        {attendees.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            No booked attendees in this class.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {attendees.map((a, i) => (
              <AttendeeRow
                key={a.memberId ?? `row-${i}`}
                name={a.name}
                memberId={a.memberId}
                status={a.status}
                editable={editable}
                busy={busySlug === a.memberId}
                onMark={handleMark}
              />
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-400/90">
          {error}
        </p>
      )}
    </main>
  );
}
