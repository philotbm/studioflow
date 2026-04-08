import Link from "next/link";
import { notFound } from "next/navigation";
import { upcomingClasses, type Attendee } from "../data";
import { applyPromotionsToClass, readPromotions } from "../promotions";
import LiveAttendees from "./live-attendees";
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

function AttendeeRow({ a }: { a: Attendee }) {
  const inner = (
    <>
      <span className="text-sm">{a.name}</span>
      <span className={`text-xs ${statusColor[a.status]}`}>
        {statusLabel[a.status]}
      </span>
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

  // Apply any cookie-backed promotions for this class so the rendered roster,
  // waitlist, and booked count all reflect the persistent promotion state.
  const promotions = await readPromotions();
  const cls = applyPromotionsToClass(sourceCls, promotions);

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
              <AttendeeRow key={i} a={a} />
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
    </main>
  );
}
