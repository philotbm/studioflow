"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useStore, formatRelative } from "@/lib/store";
import type { Attendee, WaitlistEntry } from "../data";
import { members } from "../../members/data";
import { waitlistSignalsFor, type WaitlistSignal } from "../signals";

// ── Status labels/colours ───────────────────────────────────────────────
const statusLabel: Record<string, string> = {
  booked: "Booked",
  attended: "Attended",
  late_cancel: "Late cancel",
  no_show: "No show",
  checked_in: "Checked in",
  not_checked_in: "Not checked in",
};

const statusColor: Record<string, string> = {
  booked: "text-white/50",
  attended: "text-green-400",
  late_cancel: "text-red-400",
  no_show: "text-red-400",
  checked_in: "text-green-400",
  not_checked_in: "text-white/50",
};

const lifecycleLabel: Record<string, string> = {
  upcoming: "Upcoming",
  live: "Live",
  completed: "Completed",
};

const lifecycleStyle: Record<string, string> = {
  upcoming: "text-white/60 border-white/20",
  live: "text-green-400 border-green-400/30",
  completed: "text-white/40 border-white/10",
};

// ── Attendee row ────────────────────────────────────────────────────────
function AttendeeRow({
  a,
  classId,
  onUnpromote,
}: {
  a: Attendee;
  classId: string;
  onUnpromote: (classId: string, position: number) => void;
}) {
  const statusSpan = (
    <span className={`text-xs ${statusColor[a.status]}`}>
      {statusLabel[a.status]}
    </span>
  );

  if (a.promotedFromPosition !== undefined) {
    const isAuto = a.promotionType === "auto";
    const rowBorder = isAuto ? "border-white/10" : "border-amber-400/25";
    const badgeClass = isAuto
      ? "border-white/15 text-white/40"
      : "border-amber-400/30 text-amber-400/80";
    const badgeLabel = isAuto ? "Auto" : "Promoted";

    return (
      <li
        className={`flex items-center justify-between gap-3 rounded border ${rowBorder} px-4 py-2`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {a.memberId ? (
            <Link
              href={`/app/members/${a.memberId}`}
              className="text-sm hover:underline"
            >
              {a.name}
            </Link>
          ) : (
            <span className="text-sm">{a.name}</span>
          )}
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {!isAuto && (
            <button
              onClick={() => onUnpromote(classId, a.promotedFromPosition!)}
              className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              Undo
            </button>
          )}
          {statusSpan}
        </div>
      </li>
    );
  }

  const inner = (
    <>
      <span className="text-sm">{a.name}</span>
      {statusSpan}
    </>
  );

  if (a.memberId) {
    return (
      <li>
        <Link
          href={`/app/members/${a.memberId}`}
          className="flex items-center justify-between rounded border border-white/10 px-4 py-2 hover:border-white/25"
        >
          {inner}
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between rounded border border-white/10 px-4 py-2">
      {inner}
    </li>
  );
}

// ── Live attendees (with persistent check-in) ───────────────────────────
function LiveAttendees({
  classId,
  attendees,
  onCheckIn,
}: {
  classId: string;
  attendees: Attendee[];
  onCheckIn: (classId: string, index: number) => void;
}) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {attendees.map((a, i) => (
        <li
          key={i}
          className="flex items-center justify-between rounded border border-white/10 px-4 py-2"
        >
          {a.memberId ? (
            <Link
              href={`/app/members/${a.memberId}`}
              className="text-sm hover:underline"
            >
              {a.name}
            </Link>
          ) : (
            <span className="text-sm">{a.name}</span>
          )}
          {a.status === "checked_in" ? (
            <span className="text-xs text-green-400">Checked in</span>
          ) : a.status === "not_checked_in" ? (
            <button
              onClick={() => onCheckIn(classId, i)}
              className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
            >
              Check in
            </button>
          ) : (
            <span className="text-xs text-white/40">{a.status}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Signal pill (from waitlist-section) ─────────────────────────────────
function SignalPill({ signal }: { signal: WaitlistSignal }) {
  const toneClass =
    signal.tone === "positive"
      ? "border-green-400/20 text-green-400/60"
      : signal.tone === "attention"
        ? "border-amber-400/20 text-amber-400/60"
        : "border-white/10 text-white/40";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] leading-4 ${toneClass}`}
    >
      {signal.label}
    </span>
  );
}

// ── Waitlist section ────────────────────────────────────────────────────
function WaitlistSection({
  classId,
  waitlist,
  canAcceptMore,
  onPromote,
}: {
  classId: string;
  waitlist: WaitlistEntry[];
  canAcceptMore: boolean;
  onPromote: (classId: string, position: number) => void;
}) {
  if (waitlist.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">
        Waitlist
        <span className="ml-2 text-white/40">{waitlist.length}</span>
      </h2>
      <ol className="mt-3 flex flex-col gap-2">
        {waitlist.map((entry, index) => {
          const member = entry.memberId
            ? members.find((m) => m.id === entry.memberId)
            : undefined;
          const signals = waitlistSignalsFor(member);
          const isNextUp = index === 0;

          return (
            <li
              key={entry.position}
              className="flex items-start justify-between gap-3 rounded border border-white/10 px-4 py-2"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/30">
                    #{entry.position}
                  </span>
                  {entry.memberId ? (
                    <Link
                      href={`/app/members/${entry.memberId}`}
                      className="text-sm hover:underline"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="text-sm">{entry.name}</span>
                  )}
                  {isNextUp && (
                    <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      Next up
                    </span>
                  )}
                </div>
                {signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-6">
                    {signals.map((s, i) => (
                      <SignalPill key={i} signal={s} />
                    ))}
                  </div>
                )}
              </div>
              {canAcceptMore ? (
                <button
                  onClick={() => onPromote(classId, entry.position)}
                  className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
                >
                  Promote
                </button>
              ) : (
                <span className="text-xs text-white/30">Class full</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────
function PromotionAuditLog({
  classId,
  sourceWaitlist,
}: {
  classId: string;
  sourceWaitlist: WaitlistEntry[];
}) {
  const { state } = useStore();
  const forThis = state.promotionEvents.filter((e) => e.classId === classId);
  if (forThis.length === 0) return null;

  const now = Date.now();
  const nameFor = (position: number): string =>
    sourceWaitlist.find((w) => w.position === position)?.name ??
    `Waitlist #${position}`;

  const sorted = [...forThis].sort((a, b) => b.at - a.at);

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">Promotion activity</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {sorted.map((ev, i) => {
          const isPromote = ev.action === "promote";
          return (
            <li
              key={`${ev.classId}-${ev.position}-${ev.at}-${i}`}
              className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{nameFor(ev.position)}</span>
                <span className="text-xs text-white/40">
                  {isPromote
                    ? `Promoted from waitlist #${ev.position}`
                    : `Promotion reverted (back to waitlist #${ev.position})`}
                </span>
              </div>
              <span
                className={`shrink-0 text-xs ${
                  isPromote ? "text-green-400/80" : "text-amber-400/80"
                }`}
              >
                {formatRelative(ev.at, now)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Page component ──────────────────────────────────────────────────────
export default function ClassDetail({ id }: { id: string }) {
  const {
    getClassWithPromotions,
    getSourceClass,
    promoteEntry,
    unpromoteEntry,
    checkInAttendee,
  } = useStore();

  const cls = getClassWithPromotions(id);
  const sourceCls = getSourceClass(id);

  if (!cls || !sourceCls) {
    notFound();
  }

  // Upcoming classes never render "late cancel" in the roster
  const visibleAttendees =
    cls.lifecycle === "upcoming"
      ? cls.attendees.filter((a) => a.status !== "late_cancel")
      : cls.attendees;

  const displayBooked = visibleAttendees.length;
  const isFull = displayBooked >= cls.capacity;
  const isLive = cls.lifecycle === "live";

  const nonAutoAttendeeCount = cls.attendees.filter(
    (a) => a.promotionType !== "auto",
  ).length;
  const canAcceptMore =
    cls.lifecycle === "upcoming" && nonAutoAttendeeCount < cls.capacity;

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/classes"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to classes
      </Link>

      <div className="mt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{cls.name}</h1>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${lifecycleStyle[cls.lifecycle]}`}
          >
            {isLive && (
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
            {lifecycleLabel[cls.lifecycle]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/50">
          <span>{cls.time}</span>
          <span>{cls.instructor}</span>
          <span className={isFull ? "text-green-400" : ""}>
            {displayBooked}/{cls.capacity} booked
          </span>
          {cls.waitlistCount > 0 && (
            <span className="text-white/40">
              {cls.waitlistCount} on waitlist
            </span>
          )}
        </div>
        {cls.lifecycle === "upcoming" &&
          cls.cancellationWindowClosed !== undefined && (
            <p
              className={`mt-2 text-xs ${
                cls.cancellationWindowClosed
                  ? "text-amber-400/80"
                  : "text-white/40"
              }`}
            >
              {cls.cancellationWindowClosed
                ? "Cancellation window closed"
                : "Free cancellation open"}
            </p>
          )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Attendees</h2>

        {isLive ? (
          <LiveAttendees
            classId={cls.id}
            attendees={visibleAttendees}
            onCheckIn={checkInAttendee}
          />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visibleAttendees.map((a, i) => (
              <AttendeeRow
                key={i}
                a={a}
                classId={cls.id}
                onUnpromote={unpromoteEntry}
              />
            ))}
          </ul>
        )}
      </div>

      {cls.waitlist && cls.waitlist.length > 0 && (
        <WaitlistSection
          classId={cls.id}
          waitlist={cls.waitlist}
          canAcceptMore={canAcceptMore}
          onPromote={promoteEntry}
        />
      )}

      <PromotionAuditLog
        classId={sourceCls.id}
        sourceWaitlist={sourceCls.waitlist ?? []}
      />
    </main>
  );
}
