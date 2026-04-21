"use client";

import Link from "next/link";
import { useState } from "react";
import { useMember, useStore } from "@/lib/store";
import type { StudioClass } from "@/app/app/classes/data";
import {
  decideEligibility,
  consumedLabel,
  consumptionLabel,
  restorationForCancel,
} from "@/lib/eligibility";
import {
  summariseMembership,
  accessTypeLabel,
  type MembershipTone,
} from "@/lib/memberships";

/**
 * v0.10.0 member-facing booking home.
 *
 * One page per member. Reuses the shared store (bookMember /
 * cancelBooking) so server truth is unchanged — no new rules, no
 * duplicated logic. Shows three surfaces:
 *
 *   1. Header: who the member is, what their membership looks like,
 *      how many credits remain.
 *   2. Your upcoming classes: classes the member is in (booked,
 *      checked in, or waitlisted) with a Cancel action when the
 *      class is still upcoming.
 *   3. Browse classes: upcoming classes the member is NOT in, with
 *      Book / Join waitlist / Cannot book (disabled) action depending
 *      on server-derived bookingAccess + class capacity.
 */

// ── Outcome state ───────────────────────────────────────────────────
type Outcome =
  | {
      kind: "booked";
      className: string;
      when: string;
      consumption: string;
    }
  | {
      kind: "waitlisted";
      className: string;
      when: string;
      position: number;
    }
  | {
      kind: "already-in";
      className: string;
      when: string;
    }
  | {
      kind: "cancelled";
      className: string;
      when: string;
      creditRestored: boolean;
    }
  | {
      kind: "late-cancel";
      className: string;
      when: string;
    }
  | {
      kind: "blocked";
      className: string;
      reason: string;
      hint: string;
    }
  | {
      kind: "error";
      text: string;
    };

// ── Tone palette (matches the operator Membership panel palette) ───
const toneText: Record<MembershipTone, string> = {
  positive: "text-green-400",
  neutral: "text-white/60",
  attention: "text-amber-400",
  blocked: "text-red-400",
};
const toneBorder: Record<MembershipTone, string> = {
  positive: "border-green-400/25",
  neutral: "border-white/15",
  attention: "border-amber-400/30",
  blocked: "border-red-400/30",
};

// ── Status pill for "your upcoming classes" row ────────────────────
function myStatusLabel(attendeeStatus: string | undefined, waitlistPosition: number | undefined): string {
  if (attendeeStatus === "checked_in") return "Checked in";
  if (attendeeStatus === "booked") return "Booked";
  if (attendeeStatus === "no_show") return "No-show";
  if (attendeeStatus === "late_cancel") return "Late cancel";
  if (waitlistPosition !== undefined) return `Waitlist #${waitlistPosition}`;
  return "Booked";
}

// ── Outcome card ────────────────────────────────────────────────────
function OutcomeCard({
  outcome,
  onDismiss,
}: {
  outcome: Outcome;
  onDismiss: () => void;
}) {
  const palette = (() => {
    switch (outcome.kind) {
      case "booked":
      case "cancelled":
        return { border: "border-green-400/30", text: "text-green-400" };
      case "waitlisted":
      case "already-in":
        return { border: "border-white/20", text: "text-white/80" };
      case "late-cancel":
      case "blocked":
        return { border: "border-amber-400/40", text: "text-amber-400" };
      case "error":
        return { border: "border-red-400/40", text: "text-red-400" };
    }
  })();

  const title = (() => {
    switch (outcome.kind) {
      case "booked":
        return `Booked — ${outcome.className}`;
      case "waitlisted":
        return `Added to waitlist — ${outcome.className}`;
      case "already-in":
        return `You're already in ${outcome.className}`;
      case "cancelled":
        return `Cancelled — ${outcome.className}`;
      case "late-cancel":
        return `Late cancel — ${outcome.className}`;
      case "blocked":
        return `Can't book ${outcome.className}`;
      case "error":
        return "Something went wrong";
    }
  })();

  const detail = (() => {
    switch (outcome.kind) {
      case "booked":
        return `${outcome.when} · ${outcome.consumption}`;
      case "waitlisted":
        return `${outcome.when} · Position #${outcome.position} (first come, first served)`;
      case "already-in":
        return outcome.when;
      case "cancelled":
        return outcome.creditRestored
          ? `${outcome.when} · 1 credit restored`
          : `${outcome.when}`;
      case "late-cancel":
        return `${outcome.when} · No credit returned (cancelled after the window)`;
      case "blocked":
        return `${outcome.reason}. ${outcome.hint}`;
      case "error":
        return outcome.text;
    }
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-4 flex items-start justify-between gap-3 rounded border px-4 py-3 ${palette.border}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-sm font-medium ${palette.text}`}>{title}</span>
        {detail && <span className="text-xs text-white/60">{detail}</span>}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-white/30 hover:text-white/70"
      >
        ×
      </button>
    </div>
  );
}

// ── My upcoming classes row ────────────────────────────────────────
function MyClassRow({
  cls,
  attendeeStatus,
  waitlistPosition,
  onCancel,
  busy,
}: {
  cls: StudioClass;
  attendeeStatus: string | undefined;
  waitlistPosition: number | undefined;
  onCancel: () => void;
  busy: boolean;
}) {
  const statusText = myStatusLabel(attendeeStatus, waitlistPosition);
  const canCancel =
    cls.lifecycle === "upcoming" &&
    (attendeeStatus === "booked" || waitlistPosition !== undefined);
  const cutoffClosed = cls.cancellationWindowClosed === true;

  // Attendee status colour
  const statusColor = (() => {
    if (attendeeStatus === "checked_in") return "text-green-400";
    if (attendeeStatus === "no_show" || attendeeStatus === "late_cancel") return "text-red-400";
    if (waitlistPosition !== undefined) return "text-amber-400";
    return "text-white/70";
  })();

  return (
    <li className="flex flex-col gap-2 rounded border border-white/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{cls.name}</span>
        <span className="text-xs text-white/50">
          {cls.time} · {cls.instructor}
          {cls.lifecycle === "live" && (
            <span className="ml-2 rounded-full border border-green-400/30 px-1.5 py-0.5 text-[10px] uppercase text-green-400">
              Live
            </span>
          )}
        </span>
        {canCancel && cutoffClosed && (
          <span className="text-[11px] text-amber-400/80">
            Cancellation window closed — cancelling now is a late cancel
            (no credit returned).
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-xs ${statusColor}`}>{statusText}</span>
        {canCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "…" : waitlistPosition !== undefined ? "Leave waitlist" : "Cancel"}
          </button>
        )}
      </div>
    </li>
  );
}

// ── Browse row ─────────────────────────────────────────────────────
function BrowseClassRow({
  cls,
  canBook,
  blockedReason,
  blockedHint,
  onAction,
  busy,
}: {
  cls: StudioClass;
  canBook: boolean;
  blockedReason: string | null;
  blockedHint: string | null;
  onAction: () => void;
  busy: boolean;
}) {
  const nonAuto = cls.attendees.filter((a) => a.promotionType !== "auto").length;
  const spotsLeft = Math.max(0, cls.capacity - nonAuto);
  const isFull = spotsLeft <= 0;

  const capacityLabel = (() => {
    if (isFull) {
      const wl = cls.waitlist?.length ?? 0;
      return `Class full · waitlist position #${wl + 1} available`;
    }
    if (spotsLeft === 1) return "1 spot left";
    return `${spotsLeft} spots available`;
  })();

  const capacityTone = isFull
    ? "text-amber-400/80"
    : spotsLeft === 1
      ? "text-white/70"
      : "text-white/50";

  const actionLabel = !canBook
    ? "Unavailable"
    : isFull
      ? "Join waitlist"
      : "Book";

  return (
    <li className="flex flex-col gap-2 rounded border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{cls.name}</span>
        <span className="text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </span>
        <span className={`text-[11px] ${capacityTone}`}>{capacityLabel}</span>
        {!canBook && blockedReason && (
          <span className="text-[11px] text-amber-400/80">
            {blockedReason}
            {blockedHint && (
              <span className="ml-1 text-white/40">— {blockedHint}</span>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onAction}
          disabled={!canBook || busy}
          title={!canBook && blockedReason ? blockedReason : undefined}
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? "…" : actionLabel}
        </button>
      </div>
    </li>
  );
}

// ── Page ───────────────────────────────────────────────────────────
export default function MemberHome({ memberSlug }: { memberSlug: string }) {
  const member = useMember(memberSlug);
  const { classes, bookMember, cancelBooking, hydrated } = useStore();
  const [busyClassSlug, setBusyClassSlug] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading…</p>
      </main>
    );
  }

  if (!member) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/60 text-sm">We couldn&apos;t find that member.</p>
        <Link
          href="/book"
          className="mt-4 inline-block text-xs text-white/40 hover:text-white/70"
        >
          ← Back to member picker
        </Link>
      </main>
    );
  }

  const membership = summariseMembership(member);
  const eligibility = decideEligibility(member);

  // Partition all non-completed classes into "mine" vs "browse".
  // Live classes the member is not in are intentionally excluded from
  // browse — they can't retro-book a class that's already in progress.
  type MyClassEntry = {
    cls: StudioClass;
    attendeeStatus: string | undefined;
    waitlistPosition: number | undefined;
  };
  const myClasses: MyClassEntry[] = [];
  const browseClasses: StudioClass[] = [];
  for (const cls of classes) {
    if (cls.lifecycle === "completed") continue;
    const attendee = cls.attendees.find((a) => a.memberId === member.id);
    const waitlistEntry = cls.waitlist?.find((w) => w.memberId === member.id);
    if (attendee || waitlistEntry) {
      myClasses.push({
        cls,
        attendeeStatus: attendee?.status,
        waitlistPosition: waitlistEntry?.position,
      });
    } else if (cls.lifecycle === "upcoming") {
      browseClasses.push(cls);
    }
  }

  async function handleBook(cls: StudioClass) {
    if (busyClassSlug) return;
    setBusyClassSlug(cls.id);
    setOutcome(null);
    const when = `${cls.time} · ${cls.instructor}`;
    try {
      const result = await bookMember(cls.id, memberSlug);
      if (result.status === "blocked") {
        setOutcome({
          kind: "blocked",
          className: cls.name,
          reason: result.access.reason,
          hint: result.access.actionHint,
        });
      } else if (result.alreadyExists) {
        setOutcome({
          kind: "already-in",
          className: cls.name,
          when,
        });
      } else if (result.status === "booked") {
        setOutcome({
          kind: "booked",
          className: cls.name,
          when,
          consumption: consumedLabel(eligibility),
        });
      } else {
        const waitlistBefore = cls.waitlist?.length ?? 0;
        setOutcome({
          kind: "waitlisted",
          className: cls.name,
          when,
          position: waitlistBefore + 1,
        });
      }
    } catch (e) {
      setOutcome({
        kind: "error",
        text: e instanceof Error ? e.message : "Booking failed",
      });
    } finally {
      setBusyClassSlug(null);
    }
  }

  async function handleCancel(entry: MyClassEntry) {
    if (busyClassSlug) return;
    const cls = entry.cls;
    setBusyClassSlug(cls.id);
    setOutcome(null);
    const when = `${cls.time} · ${cls.instructor}`;
    const isWaitlistLeave = entry.waitlistPosition !== undefined;
    // Predict restoration locally for the outcome copy. Server remains
    // authoritative; we only use this to shape the success sentence.
    const predicted = restorationForCancel(membership.accessType, false);
    try {
      const result = await cancelBooking(cls.id, memberSlug);
      if (result.result === "late_cancel") {
        setOutcome({ kind: "late-cancel", className: cls.name, when });
      } else {
        setOutcome({
          kind: "cancelled",
          className: cls.name,
          when,
          // Waitlist cancels never restore credit (no credit was taken);
          // bookings restore per the restorationForCancel rule.
          creditRestored: !isWaitlistLeave && predicted.restoresCredits === 1,
        });
      }
    } catch (e) {
      setOutcome({
        kind: "error",
        text: e instanceof Error ? e.message : "Cancellation failed",
      });
    } finally {
      setBusyClassSlug(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/book"
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← Switch member
      </Link>

      {/* Header */}
      <div className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Hi {member.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Here are your upcoming classes and what&apos;s available to book.
        </p>
      </div>

      {/* Membership card (stripped-down operator Membership panel) */}
      <div
        className={`mt-4 rounded border px-4 py-3 ${toneBorder[membership.tone]}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-white/40">
            Your membership
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${toneBorder[membership.tone]} ${toneText[membership.tone]}`}
          >
            {accessTypeLabel(membership)}
          </span>
        </div>
        <p className={`mt-2 text-sm font-medium ${toneText[membership.tone]}`}>
          {membership.summaryLine}
        </p>
        <p className="mt-1 text-xs text-white/50">
          {consumptionLabel(eligibility)}
        </p>
      </div>

      {/* Outcome card */}
      {outcome && (
        <OutcomeCard outcome={outcome} onDismiss={() => setOutcome(null)} />
      )}

      {/* Your upcoming classes */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">
          Your upcoming classes
          <span className="ml-2 text-white/40">{myClasses.length}</span>
        </h2>
        {myClasses.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            You don&apos;t have any upcoming classes yet. Browse what&apos;s
            available below.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {myClasses.map((entry) => (
              <MyClassRow
                key={entry.cls.id}
                cls={entry.cls}
                attendeeStatus={entry.attendeeStatus}
                waitlistPosition={entry.waitlistPosition}
                onCancel={() => handleCancel(entry)}
                busy={busyClassSlug === entry.cls.id}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Browse upcoming classes */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">
          Browse classes
          <span className="ml-2 text-white/40">{browseClasses.length}</span>
        </h2>
        {browseClasses.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            No upcoming classes available right now.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {browseClasses.map((cls) => (
              <BrowseClassRow
                key={cls.id}
                cls={cls}
                canBook={member.bookingAccess.canBook}
                blockedReason={
                  member.bookingAccess.canBook ? null : member.bookingAccess.reason
                }
                blockedHint={
                  member.bookingAccess.canBook ? null : member.bookingAccess.actionHint
                }
                onAction={() => handleBook(cls)}
                busy={busyClassSlug === cls.id}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
