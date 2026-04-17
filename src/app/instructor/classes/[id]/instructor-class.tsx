"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useStore } from "@/lib/store";
import type { Attendee } from "@/app/app/classes/data";
import type { AttendanceOutcome, CheckInSource } from "@/lib/db";

/**
 * v0.8.4 Instructor View
 *
 * Check-in is the positive attendance truth. The instructor view has
 * four jobs in this release:
 *
 *   1. Show the class, its lifecycle + check-in window, and the
 *      canonical-language roster.
 *   2. Display the class-specific QR code while the check-in window is
 *      OPEN so members can scan it and self-check-in.
 *   3. Provide a manual fallback: the instructor can mark a booked
 *      member as checked in if they cannot self-serve. Source = 'operator'.
 *      Source='operator' check-in is subject to the same window as
 *      client check-in — outside the window the button is disabled and
 *      a tooltip explains why.
 *   4. Provide the post-close correction path on COMPLETED classes:
 *      "Mark as checked in" / "Mark as no-show". These are NOT vague
 *      Undo/Edit actions — they are explicit, auditable transitions
 *      between the two finalised states.
 *
 * On a completed class the view auto-invokes sf_finalise_class on mount
 * so any still-booked rows get swept to no_show (pull-based close).
 * That sweep is the first visitor's responsibility; subsequent visitors
 * see an already-finalised class and the RPC is a no-op.
 *
 * Waitlist and late_cancel are excluded from the instructor roster entirely.
 */

type InstructorStatus = "booked" | "checked_in" | "no_show";

function collapseToInstructorStatus(a: Attendee): InstructorStatus | null {
  switch (a.status) {
    case "booked":
      return "booked";
    case "checked_in":
      return "checked_in";
    case "no_show":
      return "no_show";
    case "late_cancel":
      return null; // excluded from the instructor list
  }
}

const STATUS_LABEL: Record<InstructorStatus, string> = {
  booked: "Booked",
  checked_in: "Checked in",
  no_show: "No-show",
};

const STATUS_TONE: Record<InstructorStatus, string> = {
  booked: "text-white/60",
  checked_in: "text-green-400",
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

// ── Attendee row ────────────────────────────────────────────────────────
// Three modes driven by `mode`:
//   live      — full live-class controls: Mark as checked in / Mark as
//               no-show / Undo (revert to booked). The operator fallback
//               uses the same "Mark as checked in" button, which records
//               source='operator' in the audit trail via sf_check_in or
//               sf_mark_attendance (see handleMark + handleCheckIn below).
//   correction — completed-class post-close correction: explicit
//                "Mark as checked in" / "Mark as no-show" only, no Undo,
//                no "booked" revert.
//   readonly  — upcoming classes: no buttons.
type RowMode = "live" | "correction" | "readonly";

type AttendeeRowProps = {
  name: string;
  memberId?: string;
  status: InstructorStatus;
  mode: RowMode;
  // v0.8.4: when mode === 'readonly', the row surfaces this phrase so
  // the operator understands *why* attendance controls are unavailable
  // (e.g. "Check-in opens at 17:45"). Ignored in other modes.
  readonlyReason?: string;
  onCheckIn: (memberId: string) => Promise<void>;
  onMark: (memberId: string, outcome: AttendanceOutcome) => Promise<void>;
  busy: boolean;
};

function AttendeeRow({
  name,
  memberId,
  status,
  mode,
  readonlyReason,
  onCheckIn,
  onMark,
  busy,
}: AttendeeRowProps) {
  const canAct = mode !== "readonly" && !busy && memberId !== undefined;
  const isCheckedIn = status === "checked_in";
  const isNoShow = status === "no_show";

  // "Mark as checked in" button has slightly different semantics per mode:
  //   - live: first time from booked → call sf_check_in (source=operator)
  //           so it lands in the ledger as a real check-in, not a
  //           "correction". Subsequent flips from no_show → checked_in
  //           go through sf_mark_attendance as an attendance update.
  //   - correction: always goes through sf_mark_attendance so the audit
  //                 row is tagged as a post-close correction.
  function handleMarkCheckedIn() {
    if (!memberId) return;
    if (mode === "live" && status === "booked") {
      onCheckIn(memberId);
    } else {
      onMark(memberId, "checked_in");
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className={`text-xs ${STATUS_TONE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      {mode === "readonly" ? (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-xs text-white/40">{STATUS_LABEL[status]}</span>
          {readonlyReason && (
            <span className="text-[11px] text-white/30">{readonlyReason}</span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleMarkCheckedIn}
            disabled={!canAct}
            className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-30 ${
              isCheckedIn
                ? "border-green-400/60 bg-green-400/10 text-green-300"
                : "border-white/20 text-white/70 hover:border-green-400/40 hover:text-green-300"
            }`}
            aria-pressed={isCheckedIn}
          >
            {isCheckedIn ? "Checked in ✓" : "Mark as checked in"}
          </button>
          <button
            onClick={() => memberId && onMark(memberId, "no_show")}
            disabled={!canAct}
            className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:opacity-30 ${
              isNoShow
                ? "border-red-400/60 bg-red-400/10 text-red-300"
                : "border-white/20 text-white/70 hover:border-red-400/40 hover:text-red-300"
            }`}
            aria-pressed={isNoShow}
          >
            {isNoShow ? "No-show ✓" : "Mark as no-show"}
          </button>
          {/*
            Undo is LIVE-ONLY. It reverts an accidental mark to the
            booked baseline while the class is running. It is
            deliberately NOT available on completed classes — the
            correction path is explicit ("Mark as checked in" /
            "Mark as no-show") so an operator never silently knocks
            a finalised row back into a limbo state.
          */}
          {mode === "live" && status !== "booked" && canAct && (
            <button
              onClick={() => memberId && onMark(memberId, "booked")}
              disabled={!canAct}
              className="text-xs text-white/30 underline-offset-2 hover:text-white hover:underline"
              title="Revert to booked (live-class mistake correction)"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── QR panel ─────────────────────────────────────────────────────────────
function CheckInQrPanel({ classSlug }: { classSlug: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown || typeof window === "undefined") return;
    const href = `${window.location.origin}/checkin/classes/${classSlug}`;
    QRCode.toDataURL(href, { width: 240, margin: 1 })
      .then(setDataUrl)
      .catch((err) => {
        console.warn("[CheckInQrPanel] QR generation failed:", err);
      });
  }, [classSlug, shown]);

  const checkinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/checkin/classes/${classSlug}`
      : `/checkin/classes/${classSlug}`;

  return (
    <div className="mt-6 rounded border border-white/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-white/40">
          Check-in QR
        </span>
        <button
          onClick={() => setShown((s) => !s)}
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
        >
          {shown ? "Hide" : "Show QR for members"}
        </button>
      </div>
      {shown && (
        <div className="mt-4 flex flex-col items-center gap-3">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt="Class check-in QR code"
              width={240}
              height={240}
              className="rounded bg-white p-2"
            />
          ) : (
            <p className="text-xs text-white/40">Generating QR…</p>
          )}
          <p className="text-center text-[11px] text-white/40">
            Members scan this to self-check-in.
            <br />
            <a
              href={checkinUrl}
              className="break-all underline-offset-2 hover:underline"
            >
              {checkinUrl}
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page component ──────────────────────────────────────────────────────
export default function InstructorClass({ id }: { id: string }) {
  const { getClass, markAttendance, checkInMember, finaliseClass, loading } =
    useStore();
  const cls = getClass(id);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // v0.8.3 pull-based class close — fires once per completed-class view
  // mount. The RPC is idempotent server-side; this ref just avoids
  // redundant RPC calls while the store is still rehydrating.
  const sweptRef = useRef<string | null>(null);
  useEffect(() => {
    if (cls?.lifecycle === "completed" && sweptRef.current !== cls.id) {
      sweptRef.current = cls.id;
      finaliseClass(cls.id).catch((err) =>
        console.warn("[InstructorClass] finaliseClass failed:", err),
      );
    }
  }, [cls?.lifecycle, cls?.id, finaliseClass]);

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

  // v0.8.4: upcoming classes are "readonly" — instructor cannot mark
  // attendance or check members in until the check-in window opens.
  // Once the window opens (pre-class lobby) we switch to "live" mode
  // so the operator can use the manual fallback; the DB still
  // enforces the window on its own.
  const mode: RowMode =
    cls.lifecycle === "completed"
      ? "correction"
      : cls.checkInStatus === "open"
        ? "live"
        : "readonly";

  function formatClockTime(iso: string): string {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const checkedInCount = attendees.filter((a) => a.status === "checked_in").length;
  const noShowCount = attendees.filter((a) => a.status === "no_show").length;
  const pendingCount = attendees.filter((a) => a.status === "booked").length;

  async function handleCheckIn(memberSlug: string) {
    setBusySlug(memberSlug);
    setError(null);
    try {
      // Instructor fallback check-in → source='operator'. Same window
      // gate as client check-in — outside the window the server will
      // reject with a status_code; we surface the message as an inline
      // banner so the operator can see why the action did nothing.
      const source: CheckInSource = "operator";
      const outcome = await checkInMember(cls!.id, memberSlug, source);
      if (!outcome.ok) setError(outcome.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check in");
    } finally {
      setBusySlug(null);
    }
  }

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
      {cls.lifecycle === "upcoming" && cls.checkInStatus === "pre_window" && (
        <div className="mt-6 rounded border border-white/10 px-4 py-3 text-xs text-white/50">
          Check-in opens at {formatClockTime(cls.checkInOpensAt)} —
          {" "}
          {cls.checkInWindowMinutes} min before class start.
          Attendance controls unlock then.
        </div>
      )}
      {cls.checkInStatus === "open" && cls.lifecycle === "upcoming" && (
        <div className="mt-6 rounded border border-green-400/20 px-4 py-3 text-xs text-green-200/80">
          Check-in window is open — members can self-check-in via the QR
          code below, or you can use the manual fallback on each row.
        </div>
      )}
      {cls.lifecycle === "completed" && (
        <div className="mt-6 rounded border border-amber-400/20 px-4 py-3 text-xs text-amber-200/80">
          Class is completed — post-class corrections only. Use the
          explicit <strong>Mark as checked in</strong> / <strong>Mark as no-show</strong> actions
          to correct a row. Each correction is appended to the audit
          trail — previous history is preserved.
        </div>
      )}

      {/* QR panel — shown whenever the check-in window is OPEN, which
          covers both the pre-class lobby (upcoming + inside window) and
          the live class itself. */}
      {cls.checkInStatus === "open" && <CheckInQrPanel classSlug={cls.id} />}

      {/* Summary counters — shown once the check-in window is open
          or the class has finished. Pure upcoming classes stay quiet. */}
      {(mode === "live" || mode === "correction") && (
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Checked in</span>
            <p className="text-lg font-semibold text-green-400">{checkedInCount}</p>
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
            {attendees.map((a, i) => {
              const readonlyReason =
                mode !== "readonly"
                  ? undefined
                  : cls.checkInStatus === "pre_window"
                    ? `Opens ${formatClockTime(cls.checkInOpensAt)}`
                    : "Attendance controls locked";
              return (
                <AttendeeRow
                  key={a.memberId ?? `row-${i}`}
                  name={a.name}
                  memberId={a.memberId}
                  status={a.status}
                  mode={mode}
                  readonlyReason={readonlyReason}
                  busy={busySlug === a.memberId}
                  onCheckIn={handleCheckIn}
                  onMark={handleMark}
                />
              );
            })}
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
