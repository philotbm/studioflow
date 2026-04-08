import Link from "next/link";
import { promoteWaitlistEntry } from "../actions";
import type { WaitlistEntry } from "../data";
import { members } from "../../members/data";
import { waitlistSignalsFor, type WaitlistSignal } from "../signals";

function SignalPill({ signal }: { signal: WaitlistSignal }) {
  const toneClass =
    signal.tone === "positive"
      ? "border-green-400/30 text-green-400/80"
      : signal.tone === "attention"
        ? "border-amber-400/30 text-amber-400/80"
        : "border-white/15 text-white/50";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] leading-4 ${toneClass}`}
    >
      {signal.label}
    </span>
  );
}

export default function WaitlistSection({
  classId,
  waitlist,
  canAcceptMore,
}: {
  classId: string;
  waitlist: WaitlistEntry[];
  canAcceptMore: boolean;
}) {
  if (waitlist.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">
        Waitlist
        <span className="ml-2 text-white/40">{waitlist.length}</span>
      </h2>
      <ol className="mt-3 flex flex-col gap-2">
        {waitlist.map((entry) => {
          const member = entry.memberId
            ? members.find((m) => m.id === entry.memberId)
            : undefined;
          const signals = waitlistSignalsFor(member);

          return (
            <li
              key={entry.position}
              className="flex items-start justify-between gap-3 rounded border border-white/10 px-4 py-2"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/30">
                    #{entry.position}
                  </span>
                  {entry.memberId ? (
                    <Link
                      href={`/app/members/${entry.memberId}`}
                      className="text-sm hover:underline"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="text-sm">{entry.name}</span>
                  )}
                </div>
                {signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-6">
                    {signals.map((s, i) => (
                      <SignalPill key={i} signal={s} />
                    ))}
                  </div>
                )}
              </div>
              {canAcceptMore ? (
                <form action={promoteWaitlistEntry}>
                  <input type="hidden" name="classId" value={classId} />
                  <input
                    type="hidden"
                    name="position"
                    value={entry.position}
                  />
                  <button
                    type="submit"
                    className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
                  >
                    Promote
                  </button>
                </form>
              ) : (
                <span className="text-xs text-white/30">Class full</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
