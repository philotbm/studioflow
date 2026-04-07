import Link from "next/link";
import { notFound } from "next/navigation";
import { members, type Member } from "../data";

function statusLine(member: Member): { label: string; style: string } {
  if (member.credits === null) {
    return { label: "Active", style: "text-green-400" };
  }
  if (member.credits === 0) {
    return { label: "No credits remaining", style: "text-red-400" };
  }
  if (member.credits === 1) {
    return { label: "1 credit remaining", style: "text-amber-400" };
  }
  return { label: `${member.credits} credits remaining`, style: "text-white/60" };
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-amber-400";
  return "text-red-400";
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

  const status = statusLine(member);
  const ins = member.insights;

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/members"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to members
      </Link>

      {/* Current snapshot */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="text-white/40">Active plan</dt>
            <dd className="text-white/80">{member.plan}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/40">Status</dt>
            <dd className={status.style}>{status.label}</dd>
          </div>
        </dl>
      </div>

      {/* Insights */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Insights</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Attended</span>
            <p className="text-lg font-semibold">{ins.totalAttended}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Late cancels</span>
            <p className={`text-lg font-semibold ${ins.lateCancels > 0 ? "text-red-400" : ""}`}>
              {ins.lateCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">No-shows</span>
            <p className={`text-lg font-semibold ${ins.noShows > 0 ? "text-red-400" : ""}`}>
              {ins.noShows}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Cancel rate</span>
            <p className="text-lg font-semibold">{ins.cancellationRate}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Pre-cutoff cancels</span>
            <p className="text-lg font-semibold">{ins.preCutoffCancels}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Post-cutoff cancels</span>
            <p className={`text-lg font-semibold ${ins.postCutoffCancels > 0 ? "text-red-400" : ""}`}>
              {ins.postCutoffCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Avg hold before cancel</span>
            <p className="text-lg font-semibold">{ins.avgHoldBeforeCancel}</p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2 col-span-2 sm:col-span-2">
            <span className="text-xs text-white/40">Behaviour score</span>
            <p className={`text-lg font-semibold ${scoreColor(ins.behaviourScore)}`}>
              {ins.behaviourScore}/100
            </p>
          </div>
        </div>

        {ins.classMix.length > 0 && (
          <div className="mt-4">
            <span className="text-xs text-white/40">Class mix</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ins.classMix.map((c) => (
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

      {/* History */}
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
