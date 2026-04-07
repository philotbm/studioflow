import Link from "next/link";
import { notFound } from "next/navigation";
import { upcomingClasses } from "../data";

const statusLabel: Record<string, string> = {
  booked: "Booked",
  attended: "Attended",
  late_cancel: "Late cancel",
};

const statusColor: Record<string, string> = {
  booked: "text-white/50",
  attended: "text-green-400",
  late_cancel: "text-red-400",
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

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/classes"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to classes
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">{cls.name}</h1>
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
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Attendees</h2>
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
      </div>
    </main>
  );
}
