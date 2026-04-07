import Link from "next/link";
import { notFound } from "next/navigation";
import { members, type Member } from "../data";

function creditDisplay(member: Member) {
  if (member.credits === null) return { text: "Unlimited", style: "text-green-400" };
  if (member.credits === 0) return { text: "No credits", style: "text-red-400" };
  if (member.credits === 1) return { text: "1 credit left", style: "text-amber-400" };
  return { text: `${member.credits} credits`, style: "text-white/50" };
}

const eventColor: Record<string, string> = {
  upcoming: "text-white/60",
  attended: "text-green-400",
  late_cancel: "text-red-400",
  no_show: "text-red-400",
  purchase: "text-blue-400",
  started: "text-blue-400",
};

const eventLabel: Record<string, string> = {
  upcoming: "Upcoming",
  attended: "Attended",
  late_cancel: "Late cancel",
  no_show: "No show",
  purchase: "Purchase",
  started: "Started",
};

export function generateStaticParams() {
  return members.map((m) => ({ id: m.id }));
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = members.find((m) => m.id === id);

  if (!member) {
    notFound();
  }

  const credit = creditDisplay(member);

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/members"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to members
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/50">
          <span>{member.plan}</span>
          <span className={credit.style}>{credit.text}</span>
        </div>
      </div>

      {/* Insights */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Insights</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Attended</span>
            <p className="text-lg font-semibold">{member.insights.totalAttended}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Late cancels</span>
            <p className={`text-lg font-semibold ${member.insights.lateCancels > 0 ? "text-red-400" : ""}`}>
              {member.insights.lateCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">No-shows</span>
            <p className={`text-lg font-semibold ${member.insights.noShows > 0 ? "text-red-400" : ""}`}>
              {member.insights.noShows}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Cancel rate</span>
            <p className="text-lg font-semibold">{member.insights.cancellationRate}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2 col-span-2 sm:col-span-1">
            <span className="text-xs text-white/40">Avg hold before cancel</span>
            <p className="text-lg font-semibold">{member.insights.avgHoldBeforeCancel}</p>
          </div>
        </div>

        {member.insights.classMix.length > 0 && (
          <div className="mt-4">
            <span className="text-xs text-white/40">Class mix</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {member.insights.classMix.map((c) => (
                <span
                  key={c.label}
                  className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-white/60"
                >
                  {c.label} <span className="text-white/30">&times;{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {member.history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-white/70">History</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {member.history.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 rounded border border-white/10 px-4 py-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm text-white/80 truncate">{h.event}</span>
                  <span className="text-xs text-white/30">{h.date}</span>
                </div>
                <span className={`shrink-0 text-xs ${eventColor[h.type]}`}>
                  {eventLabel[h.type]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
