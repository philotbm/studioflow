import Link from "next/link";
import { upcomingClasses } from "./data";

export default function ClassesPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add class
        </button>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {upcomingClasses.map((cls) => {
          const isFull = cls.booked >= cls.capacity;
          return (
            <li key={cls.id}>
              <Link
                href={`/app/classes/${cls.id}`}
                className="flex flex-col gap-1 rounded-lg border border-white/10 px-4 py-3 hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{cls.name}</span>
                  <span className="text-xs text-white/50">
                    {cls.time} &middot; {cls.instructor}
                  </span>
                </div>
                <span
                  className={`mt-1 text-xs sm:mt-0 ${
                    isFull ? "text-green-400" : "text-white/50"
                  }`}
                >
                  {cls.booked}/{cls.capacity} booked
                  {isFull && cls.waitlistCount > 0 && (
                    <span className="text-white/40">
                      {" "}
                      &middot; {cls.waitlistCount} on waitlist
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
