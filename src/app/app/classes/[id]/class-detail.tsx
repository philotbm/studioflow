"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, formatRelative } from "@/lib/store";
import type { Attendee, WaitlistEntry, Lifecycle } from "../data";
import { qaFixtureFor, type AuditEvent } from "@/lib/db";
import { waitlistSignalsFor, type WaitlistSignal } from "../signals";
import QaFixtureBanner from "@/app/qa/QaFixtureBanner";
import { reconcileClass } from "../reconciliation";
import ReconciliationPanel from "../ReconciliationPanel";
import {
  decideEligibility,
  consumedLabel,
  consumptionLabel,
} from "@/lib/eligibility";
import {
  summariseMembership,
  accessTypeLabel,
} from "@/lib/memberships";

// ── Canonical attendance status language (v0.8.4) ───────────────────────
// These labels are the ONLY visible attendance language in the operator
// view. They match the instructor view and client check-in surfaces
// verbatim so there is no drift. Legacy 'attended' is gone — the DB
// constraint forbids it from v0.8.4 onwards, and this map reflects the
// new single vocabulary. If you need to add a new state, extend every
// surface together and update src/app/app/classes/data.ts#Attendee.
const statusLabel: Record<string, string> = {
  booked: "Booked",
  checked_in: "Checked in",
  no_show: "No-show",
  late_cancel: "Late cancel",
  cancelled: "Cancelled",
};

const statusColor: Record<string, string> = {
  booked: "text-white/60",
  checked_in: "text-green-400",
  no_show: "text-red-400",
  late_cancel: "text-red-400",
  cancelled: "text-white/40",
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

// ── Add member control ──────────────────────────────────────────────────
type AddFeedback =
  | { kind: "ok"; text: string }
  | { kind: "blocked"; text: string; hint: string }
  | { kind: "error"; text: string };

function AddMemberControl({
  classId,
  existingMemberIds,
}: {
  classId: string;
  existingMemberIds: Set<string>;
}) {
  const { members, bookMember } = useStore();
  const [selectedSlug, setSelectedSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);

  const availableMembers = members.filter(
    (m) => !existingMemberIds.has(m.id),
  );

  // v0.8.0: read the server-derived booking access state directly from
  // the member object — it comes from v_members_with_access so the
  // operator sees the exact reason the DB would enforce. No client-side
  // rules re-implementation anywhere in this file.
  const selectedMember = selectedSlug
    ? members.find((m) => m.id === selectedSlug)
    : undefined;
  const selectedAccess = selectedMember?.bookingAccess ?? null;

  async function handleBook() {
    if (!selectedSlug || busy) return;
    setBusy(true);
    setFeedback(null);
    // v0.9.0: capture the pre-booking entitlement decision so we can
    // report "1 credit used" / "unlimited" / "drop-in" on success.
    const preBookingDecision = selectedMember
      ? decideEligibility(selectedMember)
      : null;
    try {
      const result = await bookMember(classId, selectedSlug);
      if (result.status === "blocked") {
        setFeedback({
          kind: "blocked",
          text: result.access.reason,
          hint: result.access.actionHint,
        });
      } else if (result.alreadyExists) {
        setFeedback({ kind: "ok", text: "Already in this class" });
      } else {
        const base =
          result.status === "booked" ? "Booked" : "Added to waitlist";
        const consumption =
          result.status === "booked" && preBookingDecision
            ? ` · ${consumedLabel(preBookingDecision)}`
            : "";
        setFeedback({ kind: "ok", text: `${base}${consumption}` });
      }
      if (result.status !== "blocked") setSelectedSlug("");
    } catch (e) {
      setFeedback({
        kind: "error",
        text: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setBusy(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  if (availableMembers.length === 0) return null;

  const feedbackColor =
    feedback?.kind === "blocked"
      ? "text-amber-400/90"
      : feedback?.kind === "error"
        ? "text-red-400/90"
        : "text-green-400/80";

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="rounded border border-white/20 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-white/40"
        >
          <option value="">Add member...</option>
          {availableMembers.map((m) => {
            const a = m.bookingAccess;
            const suffix = a.canBook
              ? `— ${a.entitlementLabel}`
              : `— ${a.reason}`;
            return (
              <option key={m.id} value={m.id}>
                {m.name} {suffix}
              </option>
            );
          })}
        </select>
        <button
          onClick={handleBook}
          // v0.9.2: pre-emptive UI gate. The server (sf_book_member)
          // remains the authoritative enforcement point, but this keeps
          // operators from clicking Book for a member who is already
          // known to be blocked. The server call still happens on any
          // click that slips through (e.g. state races).
          disabled={
            !selectedSlug ||
            busy ||
            (selectedAccess ? !selectedAccess.canBook : false)
          }
          title={
            selectedAccess && !selectedAccess.canBook
              ? `Blocked — ${selectedAccess.reason}`
              : undefined
          }
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? "..." : "Book"}
        </button>
        {feedback && (
          <span className={`text-xs ${feedbackColor}`}>
            {feedback.text}
            {feedback.kind === "blocked" && (
              <span className="ml-1 text-white/40">— {feedback.hint}</span>
            )}
          </span>
        )}
      </div>

      {selectedAccess && selectedMember && (() => {
        // v0.9.4: pair the server's booking-gating verdict (`canBook`,
        // `reason`, `actionHint` — authoritative) with the client-side
        // commercial summary so the operator sees *both* the rule-level
        // answer ("Cannot book — no credits") AND the commercial context
        // ("5-Class Pass · Drained — needs renewal"). The summary is
        // presentation-only — see src/lib/memberships.ts.
        const membership = summariseMembership(selectedMember);
        return (
          <div
            className={`rounded border px-2.5 py-1.5 text-[11px] ${
              selectedAccess.canBook
                ? "border-white/10 text-white/50"
                : "border-amber-400/30 text-amber-400/80"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="uppercase tracking-wide text-white/30">
                {accessTypeLabel(membership)}
              </span>
              <span className="text-white/60">{membership.summaryLine}</span>
            </div>
            {selectedAccess.canBook ? (
              <div className="mt-1 text-white/40">
                Entitlement: {selectedAccess.entitlementLabel}
                <span className="ml-1 text-white/30">
                  · {consumptionLabel(decideEligibility(selectedMember))}
                </span>
              </div>
            ) : (
              <div className="mt-1">
                <span className="font-medium">
                  Cannot book — {selectedAccess.reason}.
                </span>{" "}
                <span className="text-white/50">{selectedAccess.actionHint}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Attendee row ────────────────────────────────────────────────────────
function AttendeeRow({
  a,
  classId,
  lifecycle,
  onUnpromote,
  onCancel,
}: {
  a: Attendee;
  classId: string;
  lifecycle: Lifecycle;
  onUnpromote: (classSlug: string, memberSlug: string, position: number) => void;
  onCancel: (classSlug: string, memberSlug: string) => Promise<unknown>;
}) {
  const isUpcoming = lifecycle === "upcoming";
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
          {!isAuto && a.memberId && isUpcoming && (
            <button
              onClick={() => onUnpromote(classId, a.memberId!, a.promotedFromPosition!)}
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

  // Non-promoted attendee
  return (
    <li className="flex items-center justify-between rounded border border-white/10 px-4 py-2">
      <div className="flex items-center gap-2">
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
      </div>
      <div className="flex items-center gap-3">
        {isUpcoming && a.memberId && (
          <button
            onClick={() => onCancel(classId, a.memberId!)}
            className="text-xs text-white/30 underline-offset-2 hover:text-red-400 hover:underline"
          >
            Cancel
          </button>
        )}
        {statusSpan}
      </div>
    </li>
  );
}

// ── Signal pill ─────────────────────────────────────────────────────────
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
  onCancel,
  getMember,
}: {
  classId: string;
  waitlist: WaitlistEntry[];
  canAcceptMore: boolean;
  onPromote: (classSlug: string, memberSlug: string) => Promise<void>;
  onCancel: (classSlug: string, memberSlug: string) => Promise<unknown>;
  getMember: (slug: string) => import("@/app/app/members/data").Member | undefined;
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
            ? getMember(entry.memberId)
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
              <div className="flex items-center gap-2">
                {entry.memberId && (
                  <button
                    onClick={() => onCancel(classId, entry.memberId!)}
                    className="text-xs text-white/30 underline-offset-2 hover:text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                )}
                {/* v0.9.2: Promote is gated by the waitlisted member's
                    own booking access, not just capacity. sf_promote_member
                    server-side already rejects ineligible promotions; the
                    UI now reflects the same truth so operators can't send
                    a doomed promote click. */}
                {(() => {
                  const memberCanBook = member?.bookingAccess.canBook ?? true;
                  const memberBlockReason = member?.bookingAccess.reason;
                  if (!canAcceptMore) {
                    return <span className="text-xs text-white/30">Class full</span>;
                  }
                  if (!entry.memberId) return null;
                  if (!memberCanBook) {
                    return (
                      <span
                        className="text-xs text-amber-400/70"
                        title={memberBlockReason}
                      >
                        Blocked — {memberBlockReason}
                      </span>
                    );
                  }
                  return (
                    <button
                      onClick={() => onPromote(classId, entry.memberId!)}
                      className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
                    >
                      Promote
                    </button>
                  );
                })()}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Booking activity log ────────────────────────────────────────────────
function BookingAuditLog({ classSlug }: { classSlug: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const { getAuditEvents, classes } = useStore();

  useEffect(() => {
    getAuditEvents(classSlug).then(setEvents);
  }, [classSlug, getAuditEvents, classes]);

  if (events.length === 0) return null;

  const now = Date.now();

  function eventColor(type: string): string {
    switch (type) {
      case "booked":
      case "promoted_manual":
      case "promoted_auto":
      case "attendance_checked_in":
      case "checked_in":
      case "correction_checked_in":
        return "text-green-400/80";
      case "attendance_no_show":
      case "auto_no_show":
      case "correction_no_show":
        return "text-red-400/80";
      case "attendance_reverted":
        return "text-white/50";
      case "cancelled":
      case "unpromoted":
      case "waitlisted":
        return "text-amber-400/80";
      case "late_cancel":
        return "text-red-400/80";
      default:
        return "text-white/40";
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">Booking activity</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {events.map((ev) => (
          <li
            key={ev.id}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{ev.memberName ?? "Unknown"}</span>
              <span className="text-xs text-white/40">
                {ev.eventLabel ?? ev.eventType}
              </span>
            </div>
            <span className={`shrink-0 text-xs ${eventColor(ev.eventType)}`}>
              {formatRelative(new Date(ev.createdAt).getTime(), now)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page component ──────────────────────────────────────────────────────
export default function ClassDetail({ id }: { id: string }) {
  const {
    getClass,
    getMember,
    bookMember,
    cancelBooking,
    promoteEntry,
    unpromoteEntry,
    finaliseClass,
    hydrated,
  } = useStore();

  const cls = getClass(id);
  const isQaFixture = qaFixtureFor(id) !== null;

  // v0.8.3 pull-based class close: when the operator views a completed
  // class, we idempotently sweep any still-booked rows to no_show. The
  // RPC is a no-op if there's nothing to sweep; loadData is only
  // triggered inside the store if swept>0. Ref-guarded so a single
  // mount fires at most one sweep attempt per class even as the
  // classes array updates behind us.
  const sweptRef = useRef<string | null>(null);
  useEffect(() => {
    if (cls?.lifecycle === "completed" && sweptRef.current !== cls.id) {
      sweptRef.current = cls.id;
      finaliseClass(cls.id).catch((err) =>
        console.warn("[ClassDetail] finaliseClass failed:", err),
      );
    }
  }, [cls?.lifecycle, cls?.id, finaliseClass]);

  // v0.8.5.1: this hook MUST stay above the `if (!cls)` early return
  // below. Placing it after the early return produces a different
  // hook-count on the first (no-class) render than on the rehydrated
  // render, which React detects as a rules-of-hooks violation and
  // throws on — the symptom is a detail page stuck on "Loading class…"
  // because the crash unmounts the real content. Compute null-safely
  // here and consume below.
  const reconciliation = useMemo(
    () => (cls ? reconcileClass(cls) : null),
    [cls],
  );

  if (!cls) {
    if (!hydrated) {
      return (
        <main className="mx-auto max-w-2xl pt-12 text-center">
          <p className="text-white/40">Loading class...</p>
        </main>
      );
    }
    // v0.8.4.2: store hydrated but class is absent. Distinguish QA
    // fixture gap from a genuine not-found so the operator view no
    // longer hangs indefinitely on "Loading class...".
    return (
      <main className="mx-auto max-w-2xl">
        <QaFixtureBanner classSlug={id} missing={isQaFixture} />
        {!isQaFixture && (
          <p className="pt-12 text-center text-white/40">Class not found.</p>
        )}
        <Link
          href={isQaFixture ? "/qa" : "/app/classes"}
          className="mt-4 inline-block text-xs text-white/40 hover:text-white/70"
        >
          &larr; {isQaFixture ? "Back to QA matrix" : "Back to classes"}
        </Link>
      </main>
    );
  }

  // Upcoming classes never render "late cancel" in the roster
  const visibleAttendees =
    cls.lifecycle === "upcoming"
      ? cls.attendees.filter((a) => a.status !== "late_cancel")
      : cls.attendees;

  const displayBooked = visibleAttendees.length;
  const isFull = displayBooked >= cls.capacity;
  const isUpcoming = cls.lifecycle === "upcoming";

  const nonAutoAttendeeCount = cls.attendees.filter(
    (a) => a.promotionType !== "auto",
  ).length;
  const canAcceptMore = isUpcoming && nonAutoAttendeeCount < cls.capacity;

  // Collect all member IDs already in this class (attendees + waitlist)
  const existingMemberIds = new Set<string>();
  for (const a of cls.attendees) {
    if (a.memberId) existingMemberIds.add(a.memberId);
  }
  for (const w of cls.waitlist ?? []) {
    if (w.memberId) existingMemberIds.add(w.memberId);
  }

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
            {cls.lifecycle === "live" && (
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
        {isUpcoming && cls.cancellationWindowClosed !== undefined && (
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
        {/* v0.8.2: jump into the focused instructor attendance view. */}
        <div className="mt-3">
          <Link
            href={`/instructor/classes/${cls.id}`}
            className="inline-block rounded border border-white/20 px-2.5 py-1 text-xs text-white/70 hover:border-white/40 hover:text-white"
          >
            Open Instructor View &rarr;
          </Link>
        </div>
      </div>

      {/* v0.8.5 reconciliation panel — one-glance attendance truth
          + plain-English interpretation. Completed classes get the
          reconciled "what happened" view; live + upcoming get the
          equivalent current-state view. v0.8.5.1 guards the render on
          a non-null reconciliation so an unexpected derivation failure
          never cascades into a whole-page crash. */}
      {reconciliation && (
        <ReconciliationPanel
          summary={reconciliation}
          lifecycle={cls.lifecycle}
        />
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Attendees</h2>

        {isUpcoming && (
          <AddMemberControl
            classId={cls.id}
            existingMemberIds={existingMemberIds}
          />
        )}

        {/*
          v0.8.2.1: single unified attendee list for all lifecycles.
          Live classes no longer have a separate check-in branch — the
          operator uses the "Open Instructor View →" link above to run
          attendance, and this list just displays the canonical status
          (Booked / Attended / No-show / Late cancel) consistently.
          Cancel is gated inside AttendeeRow on isUpcoming, so live and
          completed classes render a read-only status column here.
        */}
        <ul className="mt-3 flex flex-col gap-2">
          {visibleAttendees.map((a, i) => (
            <AttendeeRow
              key={a.memberId ?? i}
              a={a}
              classId={cls.id}
              lifecycle={cls.lifecycle}
              onUnpromote={unpromoteEntry}
              onCancel={cancelBooking}
            />
          ))}
        </ul>
      </div>

      {cls.waitlist && cls.waitlist.length > 0 && (
        <WaitlistSection
          classId={cls.id}
          waitlist={cls.waitlist}
          canAcceptMore={canAcceptMore}
          onPromote={promoteEntry}
          onCancel={cancelBooking}
          getMember={getMember}
        />
      )}

      <BookingAuditLog classSlug={cls.id} />
    </main>
  );
}
