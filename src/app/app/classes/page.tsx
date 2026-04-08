import Link from "next/link";
import { upcomingClasses, type StudioClass } from "./data";

const liveClasses = upcomingClasses.filter((c) => c.lifecycle === "live");
const upcoming = upcomingClasses.filter((c) => c.lifecycle === "upcoming");
const completed = upcomingClasses.filter((c) => c.lifecycle === "completed");

function ClassCard({ cls, muted }: { cls: StudioClass; muted?: boolean }) {
  const booked = cls.attendees.length;
  const waitlistCount = cls.waitlist?.length ?? 0;
  const isFull = booked >= cls.capacity;
  const isUpcoming = cls.lifecycle === "upcoming";
  return (
    <li>
      <Link
        href={`/app/classes/${cls.id}`}
        className={`flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
          muted
            ? "border-white/5 hover:border-white/15"
            : "border-white/10 hover:border-white/25"
        }`}
      >
        <div className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${muted ? "text-white/50" : ""}`}>
            {cls.name}
          </span>
          <span className={`text-xs ${muted ? "text-white/30" : "text-white/50"}`}>
            {cls.time} &middot; {cls.instructor}
          </span>
          {isUpcoming && cls.cancellationWindowClosed !== undefined && (
            <span
              className={`text-xs ${
                cls.cancellationWindowClosed
                  ? "text-amber-400/80"
                  : "text-white/30"
              }`}
            >
              {cls.cancellationWindowClosed
                ? "Cancellation window closed"
                : "Free cancellation open"}
            </span>
          )}
        </div>
        <span
          className={`mt-1 text-xs sm:mt-0 ${
            isFull ? (muted ? "text-green-400/50" : "text-green-400") : muted ? "text-white/30" : "text-white/50"
          }`}
        >
          {booked}/{cls.capacity} booked
          {isFull && waitlistCount > 0 && (
            <span className={muted ? "text-white/20" : "text-white/40"}>
              {" "}&middot; {waitlistCount} on waitlist
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default function ClassesPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add class
        </button>
      </div>

      {/* Live */}
      {liveClasses.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-medium text-green-400">Live now</h2>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {liveClasses.map((cls) => (
              <ClassCard key={cls.id} cls={cls} />
            ))}
          </ul>
        </section>
      )}

      {/* Upcoming */}
      <section className={liveClasses.length > 0 ? "mt-8" : "mt-6"}>
        <h2 className="text-sm font-medium text-white/70">Upcoming</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {upcoming.map((cls) => (
            <ClassCard key={cls.id} cls={cls} />
          ))}
        </ul>
      </section>

      {/* Completed */}
      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-white/40">Completed</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {completed.map((cls) => (
              <ClassCard key={cls.id} cls={cls} muted />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
