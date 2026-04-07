import Link from "next/link";
import { notFound } from "next/navigation";
import { members, type Member, type PurchaseEntry } from "../data";

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

function behaviourColor(label: string): string {
  if (label === "Strong") return "text-green-400";
  if (label === "Mixed") return "text-amber-400";
  return "text-red-400";
}

const eventColor: Record<string, string> = {
  upcoming: "text-white/60",
  attended: "text-green-400",
  late_cancel: "text-amber-400",
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

function PurchaseCard({ entry, label }: { entry: PurchaseEntry; label: string }) {
  if (entry.type === "credit_pack") {
    const pct = Math.round((entry.creditsUsed / entry.totalCredits) * 100);
    return (
      <div className="rounded border border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{entry.product}</span>
          <span className={`text-xs ${label === "Active" ? "text-green-400" : "text-white/30"}`}>
            {label}
          </span>
        </div>
        <span className="text-xs text-white/30">Purchased {entry.purchaseDate}</span>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <span className="text-xs text-white/40">Used</span>
            <p className="text-sm font-semibold">{entry.creditsUsed}/{entry.totalCredits}</p>
          </div>
          <div>
            <span className="text-xs text-white/40">Remaining</span>
            <p className={`text-sm font-semibold ${entry.creditsRemaining === 0 ? "text-white/30" : entry.creditsRemaining <= 1 ? "text-amber-400" : ""}`}>
              {entry.creditsRemaining}
            </p>
          </div>
          <div>
            <span className="text-xs text-white/40">Last used</span>
            <p className="text-sm font-semibold">{entry.lastUsedDate ?? "—"}</p>
          </div>
        </div>

        {/* Usage bar */}
        <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-white/30"
            style={{ width: `${pct}%` }}
          />
        </div>

        {entry.usageLog.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-white/30">Classes used</span>
            <ul className="mt-1 flex flex-col gap-1">
              {entry.usageLog.map((u, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="text-white/50">{u.className}</span>
                  <span className="text-white/25">{u.date}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (entry.type === "unlimited") {
    return (
      <div className="rounded border border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{entry.product}</span>
          <span className={`text-xs ${label === "Active" ? "text-green-400" : "text-white/30"}`}>
            {label}
          </span>
        </div>
        <span className="text-xs text-white/30">Started {entry.startDate}</span>
        <div className="mt-3">
          <span className="text-xs text-white/40">Classes since start</span>
          <p className="text-sm font-semibold">{entry.classesAttendedSinceStart}</p>
        </div>
      </div>
    );
  }

  // simple
  return (
    <div className="rounded border border-white/10 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{entry.product}</span>
        <span className={`text-xs ${label === "Active" ? "text-green-400" : "text-white/30"}`}>
          {label}
        </span>
      </div>
      <span className="text-xs text-white/30">Purchased {entry.purchaseDate}</span>
    </div>
  );
}

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
  const pi = member.purchaseInsights;

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
            <p className={`text-lg font-semibold ${ins.preCutoffCancels > 0 ? "text-amber-400" : ""}`}>
              {ins.preCutoffCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Post-cutoff cancels</span>
            <p className={`text-lg font-semibold ${ins.postCutoffCancels > 0 ? "text-amber-400" : ""}`}>
              {ins.postCutoffCancels}
            </p>
          </div>
          <div className="rounded border border-white/10 px-3 py-2">
            <span className="text-xs text-white/40">Avg hold before cancel</span>
            <p className="text-lg font-semibold">{ins.avgHoldBeforeCancel}</p>
          </div>
        </div>

        {/* Reliability */}
        <div className="mt-4 rounded border border-white/10 px-4 py-3">
          <span className="text-xs text-white/40">Reliability</span>
          <p className={`text-lg font-semibold ${behaviourColor(ins.behaviourLabel)}`}>
            {ins.behaviourLabel}
            <span className="ml-2 text-sm font-normal text-white/30">
              {ins.behaviourScore}/100
            </span>
          </p>
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

      {/* Purchase Insights */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Purchase insights</h2>
        <div className="mt-2 mb-3 text-xs text-white/40">
          Buyer pattern: <span className="text-white/60">{pi.buyerPattern}</span>
        </div>

        <div className="flex flex-col gap-4">
          <PurchaseCard entry={pi.activePlan} label="Active" />
          {pi.previousPurchases.map((p, i) => (
            <PurchaseCard key={i} entry={p} label="Previous" />
          ))}
        </div>
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
