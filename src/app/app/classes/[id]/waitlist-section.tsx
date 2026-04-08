import Link from "next/link";
import { promoteWaitlistEntry } from "../actions";
import type { WaitlistEntry } from "../data";

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
        {waitlist.map((entry) => (
          <li
            key={entry.position}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-xs text-white/30">#{entry.position}</span>
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
            {canAcceptMore ? (
              <form action={promoteWaitlistEntry}>
                <input type="hidden" name="classId" value={classId} />
                <input type="hidden" name="position" value={entry.position} />
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
        ))}
      </ol>
    </div>
  );
}
