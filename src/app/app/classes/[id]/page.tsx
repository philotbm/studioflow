import Link from "next/link";
import { notFound } from "next/navigation";
import { unpromoteWaitlistEntry } from "../actions";
import { upcomingClasses, type Attendee } from "../data";
import {
  applyPromotionsToClass,
  deriveActivePromotions,
  readPromotionEventsWithClock,
} from "../promotions";
import LiveAttendees from "./live-attendees";
import PromotionAuditLog from "./audit-log";
import WaitlistSection from "./waitlist-section";

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

function AttendeeRow({ a, classId }: { a: Attendee; classId: string }) {
  const statusSpan = (
    <span className={`text-xs ${statusColor[a.status]}`}>
      {statusLabel[a.status]}
    </span>
  );

  // Promoted entry: not a whole-row Link (the inline Unpromote form and the
  // name Link need to be siblings). Visually flagged with an amber border +
  // "Promoted" badge so the operator knows it's reversible.
  if (a.promotedFromPosition !== undefined) {
    return (
      <li className="flex items-center justify-between gap-3 rounded border border-amber-400/25 px-4 py-2">
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
          <span className="rounded-full border border-amber-400/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-400/80">
            Promoted
          </span>
        </div>
        <div className="flex items-center gap-3">
          <form action={unpromoteWaitlistEntry}>
            <input type="hidden" name="classId" value={classId} />
            <input
              type="hidden"
              name="position"
              value={a.promotedFromPosition}
            />
            <button
              type="submit"
              className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              Undo
            </button>
          </form>
          {statusSpan}
        </div>
      </li>
    );
  }

  // Non-promoted attendee — whole row is a Link when a member record exists
  // (v0.4.1 behaviour preserved).
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

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sourceCls = upcomingClasses.find((c) => c.id === id);

  if (!sourceCls) {
    notFound();
  }

  // One request-scoped read covers both needs: the active set feeds the
  // transform, the full event log feeds the audit surface, and `renderedAt`
  // is captured inside the non-component helper so the component body stays
  // free of impure calls (satisfies React's purity rules).
  const { events, now: renderedAt } = await readPromotionEventsWithClock();
  const active = deriveActivePromotions(events);
  const cls = applyPromotionsToClass(sourceCls, active);

  // Upcoming classes never render "late cancel" in the roster — a class that
  // hasn't happened yet has no attendance outcome to display.
  const visibleAttendees =
    cls.lifecycle === "upcoming"
      ? cls.attendees.filter((a) => a.status !== "late_cancel")
      : cls.attendees;

  const displayBooked = visibleAttendees.length;
  const isFull = displayBooked >= cls.capacity;
  const isLive = cls.lifecycle === "live";
  const canAcceptMore =
    cls.lifecycle === "upcoming" && cls.attendees.length < cls.capacity;

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
          <LiveAttendees initialAttendees={visibleAttendees} />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visibleAttendees.map((a, i) => (
              <AttendeeRow key={i} a={a} classId={cls.id} />
            ))}
          </ul>
        )}
      </div>

      {cls.waitlist && cls.waitlist.length > 0 && (
        <WaitlistSection
          classId={cls.id}
          waitlist={cls.waitlist}
          canAcceptMore={canAcceptMore}
        />
      )}

      <PromotionAuditLog
        sourceCls={sourceCls}
        events={events}
        now={renderedAt}
      />
    </main>
  );
}
