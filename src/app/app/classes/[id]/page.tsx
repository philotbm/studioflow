import Link from "next/link";
import { notFound } from "next/navigation";
import { upcomingClasses } from "../data";
import SessionAttendance from "./session-attendance";

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

  const isLive = cls.lifecycle === "live";
  const isUpcoming = cls.lifecycle === "upcoming";

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

      {/* Interactive attendance: capacity bar + attendees + waitlist */}
      <SessionAttendance
        initialAttendees={cls.attendees}
        initialWaitlist={cls.waitlist ?? []}
        capacity={cls.capacity}
        lifecycle={cls.lifecycle}
      />
    </main>
  );
}
