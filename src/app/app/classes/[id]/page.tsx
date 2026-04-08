import Link from "next/link";
import { notFound } from "next/navigation";
import { upcomingClasses } from "../data";
import LiveAttendees from "./live-attendees";
import WaitlistPanel from "./waitlist-panel";
import { getAttendeeDisplayStatus, toneBadgeClasses } from "./status";

const lifecycleLabel: Record<string, string> = {
  upcoming: "Upcoming",
  live: "Live",
  completed: "Completed",
};

const lifecycleStyle: Record<string, string> = {
  upcoming: "text-white/60 border-white/20 bg-white/[0.03]",
  live: "text-green-300 border-green-400/30 bg-green-400/10",
  completed: "text-white/40 border-white/10 bg-white/[0.02]",
};

export function generateStaticParams() {
  return upcomingClasses.map((cls) => ({ id: cls.id }));
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cls = upcomingClasses.find((c) => c.id === id);

  if (!cls) {
    notFound();
  }

  const isFull = cls.booked >= cls.capacity;
  const isLive = cls.lifecycle === "live";
  const isCompleted = cls.lifecycle === "completed";
  const isUpcoming = cls.lifecycle === "upcoming";
  const fillPct = Math.min(100, Math.round((cls.booked / cls.capacity) * 100));

  // Section heading copy reflects what the list actually represents
  // for the lifecycle stage of the class.
  const attendeeHeading = isUpcoming
    ? "Booked attendees"
    : isLive
    ? "Check-in"
    : "Attendance";

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/classes"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to classes
      </Link>

      {/* Header card */}
      <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{cls.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/55">
              <span>{cls.time}</span>
              <span className="text-white/20">•</span>
              <span>{cls.instructor}</span>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${lifecycleStyle[cls.lifecycle]}`}
          >
            {isLive && (
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
            {lifecycleLabel[cls.lifecycle]}
          </span>
        </div>

        {/* Capacity */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-white/50">Capacity</span>
            <span className={isFull ? "text-green-300" : "text-white/70"}>
              {cls.booked}/{cls.capacity} booked
              {isFull && cls.waitlistCount > 0 && (
                <span className="ml-2 text-white/40">
                  +{cls.waitlistCount} waitlist
                </span>
              )}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full ${
                isFull ? "bg-green-400/70" : "bg-white/40"
              }`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>

        {/* Cancellation window indicator */}
        {isUpcoming && cls.cancellationWindowClosed !== undefined && (
          <div className="mt-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                cls.cancellationWindowClosed
                  ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
                  : "border-white/15 bg-white/5 text-white/60"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  cls.cancellationWindowClosed
                    ? "bg-amber-300"
                    : "bg-white/50"
                }`}
              />
              {cls.cancellationWindowClosed
                ? "Cancellation window closed"
                : "Free cancellation open"}
            </span>
          </div>
        )}
      </section>

      {/* Attendees */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-white/70">
            {attendeeHeading}
          </h2>
          <span className="text-xs text-white/30">
            {cls.attendees.length} {cls.attendees.length === 1 ? "person" : "people"}
          </span>
        </div>

        {isLive ? (
          <LiveAttendees initialAttendees={cls.attendees} />
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {cls.attendees.map((a, i) => {
              const display = getAttendeeDisplayStatus(a, cls.lifecycle);
              return (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <span className="text-sm text-white/85">{a.name}</span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneBadgeClasses[display.tone]}`}
                  >
                    {display.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {isCompleted && (
          <p className="mt-3 text-xs text-white/30">
            Outcomes are final once the class has ended.
          </p>
        )}
      </section>

      {/* Waitlist (clickable / inspectable) */}
      {cls.waitlist && cls.waitlist.length > 0 && (
        <WaitlistPanel waitlist={cls.waitlist} />
      )}
    </main>
  );
}
