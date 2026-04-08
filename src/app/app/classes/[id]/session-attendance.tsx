"use client";

import Link from "next/link";
import { useState } from "react";
import type { Attendee, Lifecycle, WaitlistEntry } from "../data";
import { getAttendeeDisplayStatus, toneBadgeClasses } from "./status";

type Props = {
  initialAttendees: Attendee[];
  initialWaitlist: WaitlistEntry[];
  capacity: number;
  lifecycle: Lifecycle;
};

/**
 * Interactive attendance panel for a class/session. Owns:
 *   - the live capacity bar (derived from current attendee count)
 *   - check-in toggling for live classes
 *   - "promote from waitlist" for upcoming classes
 *
 * Rows are clickable links to /app/members/[id] regardless of
 * lifecycle. Inline actions (check-in, promote) stop propagation
 * so clicking the button does not also navigate away.
 */
export default function SessionAttendance({
  initialAttendees,
  initialWaitlist,
  capacity: initialCapacity,
  lifecycle,
}: Props) {
  const [attendees, setAttendees] = useState<Attendee[]>(initialAttendees);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>(initialWaitlist);
  const [capacity, setCapacity] = useState<number>(initialCapacity);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const booked = attendees.length;
  const effectiveCapacity = Math.max(capacity, booked);
  const isFull = booked >= effectiveCapacity;
  const fillPct = effectiveCapacity
    ? Math.min(100, Math.round((booked / effectiveCapacity) * 100))
    : 0;

  const isLive = lifecycle === "live";
  const isUpcoming = lifecycle === "upcoming";
  const isCompleted = lifecycle === "completed";

  const attendeeHeading = isUpcoming
    ? "Booked attendees"
    : isLive
      ? "Check-in"
      : "Attendance";

  function handleCheckIn(index: number) {
    setAttendees((prev) =>
      prev.map((a, i) =>
        i === index ? { ...a, status: "checked_in" as const } : a
      )
    );
  }

  function handlePromote(entry: WaitlistEntry) {
    // Move the waitlisted member into the booked list.
    const promoted: Attendee = {
      name: entry.name,
      memberId: entry.memberId,
      status: "booked",
    };
    setAttendees((prev) => [...prev, promoted]);
    setWaitlist((prev) => {
      const next = prev
        .filter((w) => w.position !== entry.position)
        .map((w, i) => ({ ...w, position: i + 1 }));
      return next;
    });
    // If the class was full, simulate the freshly-opened spot.
    if (booked + 1 > capacity) {
      setCapacity((c) => c + 1);
    }
  }

  return (
    <>
      {/* Capacity bar */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-white/50">Capacity</span>
          <span className={isFull ? "text-green-300" : "text-white/70"}>
            {booked}/{effectiveCapacity} booked
            {isFull && waitlist.length > 0 && (
              <span className="ml-2 text-white/40">
                +{waitlist.length} waitlist
              </span>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all ${
              isFull ? "bg-green-400/70" : "bg-white/40"
            }`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>

      {/* Attendees */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-white/70">
            {attendeeHeading}
          </h2>
          <span className="text-xs text-white/30">
            {booked} {booked === 1 ? "person" : "people"}
          </span>
        </div>

        <ul className="mt-3 flex flex-col gap-1.5">
          {attendees.map((a, i) => {
            const display = getAttendeeDisplayStatus(a, lifecycle);
            const canCheckIn =
              isLive &&
              a.status !== "checked_in" &&
              a.status !== "attended" &&
              a.status !== "late_cancel";

            return (
              <li key={`${a.memberId}-${i}`}>
                <Link
                  href={`/app/members/${a.memberId}`}
                  className="group flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 hover:border-white/25 hover:bg-white/[0.04]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-white/85 group-hover:text-white">
                      {a.name}
                    </span>
                    <span
                      aria-hidden
                      className="text-white/20 group-hover:text-white/50"
                    >
                      →
                    </span>
                  </span>
                  {canCheckIn ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCheckIn(i);
                      }}
                      className="rounded-full border border-white/20 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-white/70 hover:border-white/40 hover:bg-white/[0.08] hover:text-white"
                    >
                      Check in
                    </button>
                  ) : (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneBadgeClasses[display.tone]}`}
                    >
                      {display.label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {isCompleted && (
          <p className="mt-3 text-xs text-white/30">
            Outcomes are final once the class has ended.
          </p>
        )}
      </section>

      {/* Waitlist (inspectable + promote) */}
      {waitlist.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setWaitlistOpen((v) => !v)}
            aria-expanded={waitlistOpen}
            aria-controls="waitlist-list"
            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-left hover:border-white/25 hover:bg-white/[0.04]"
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-white/80">Waitlist</span>
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-white/70">
                {waitlist.length}
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs text-white/40">
              {waitlistOpen ? "Hide" : "View"}
              <span
                aria-hidden
                className={`inline-block transition-transform ${waitlistOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </span>
          </button>

          {waitlistOpen && (
            <ol
              id="waitlist-list"
              className="mt-2 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.015] p-2"
            >
              {waitlist.map((entry) => (
                <li key={`${entry.memberId}-${entry.position}`}>
                  <Link
                    href={`/app/members/${entry.memberId}`}
                    className="group flex items-center justify-between rounded-md px-3 py-2 hover:bg-white/[0.05]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] text-white/60">
                        {entry.position}
                      </span>
                      <span className="truncate text-sm text-white/80 group-hover:text-white">
                        {entry.name}
                      </span>
                      <span
                        aria-hidden
                        className="text-white/20 group-hover:text-white/50"
                      >
                        →
                      </span>
                    </span>
                    {isUpcoming && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handlePromote(entry);
                        }}
                        className="rounded-full border border-green-400/30 bg-green-400/10 px-2.5 py-0.5 text-[11px] text-green-300 hover:border-green-400/50 hover:bg-green-400/15"
                      >
                        Promote
                      </button>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}
