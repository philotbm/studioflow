import Link from "next/link";
import { notFound } from "next/navigation";
import { upcomingClasses } from "../data";
import LiveAttendees from "./live-attendees";

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
            {cls.booked}/{cls.capacity} booked
          </span>
          {isFull && cls.waitlistCount > 0 && (
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
          <LiveAttendees initialAttendees={cls.attendees} />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {cls.attendees.map((a, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded border border-white/10 px-4 py-2"
              >
                <span className="text-sm">{a.name}</span>
                <span className={`text-xs ${statusColor[a.status]}`}>
                  {statusLabel[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
