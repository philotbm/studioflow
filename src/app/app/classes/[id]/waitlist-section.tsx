import Link from "next/link";
import { promoteWaitlistEntry } from "../actions";
import type { WaitlistEntry } from "../data";
import { members } from "../../members/data";
import { waitlistSignalsFor, type WaitlistSignal } from "../signals";

// De-emphasised from v0.4.4: tone opacities softened from /80 → /60 and
// borders from /30 → /20 so pills read as supporting context rather than
// demanding attention, now that the queue auto-fills in FIFO order and
// the operator rarely needs to act on a signal to make a decision.
function SignalPill({ signal }: { signal: WaitlistSignal }) {
  const toneClass =
    signal.tone === "positive"
      ? "border-green-400/20 text-green-400/60"
      : signal.tone === "attention"
        ? "border-amber-400/20 text-amber-400/60"
        : "border-white/10 text-white/40";
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
        {waitlist.map((entry, index) => {
          const member = entry.memberId
            ? members.find((m) => m.id === entry.memberId)
            : undefined;
          const signals = waitlistSignalsFor(member);
          // FIFO: the first rendered waitlist entry is always the next one
          // the system will auto-promote when a spot opens. Flag it with a
          // small non-interactive "Next up" label so the operator knows
          // no action is needed — the queue handles itself.
          const isNextUp = index === 0;

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
                  {isNextUp && (
                    <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      Next up
                    </span>
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
