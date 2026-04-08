"use client";

import Link from "next/link";
import { useState } from "react";
import type { WaitlistEntry } from "../data";

type PromotedEntry = WaitlistEntry & { promoted?: boolean };

function NameCell({ entry }: { entry: PromotedEntry }) {
  if (entry.memberId) {
    return (
      <Link
        href={`/app/members/${entry.memberId}`}
        className="text-sm hover:underline"
      >
        {entry.name}
      </Link>
    );
  }
  return <span className="text-sm">{entry.name}</span>;
}

export default function WaitlistSection({
  initialWaitlist,
}: {
  initialWaitlist: WaitlistEntry[];
}) {
  const [entries, setEntries] = useState<PromotedEntry[]>(initialWaitlist);

  function handlePromote(position: number) {
    setEntries((prev) =>
      prev.map((e) => (e.position === position ? { ...e, promoted: true } : e))
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/70">
        Waitlist
        <span className="ml-2 text-white/40">{entries.length}</span>
      </h2>
      <ol className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.position}
            className="flex items-center justify-between gap-3 rounded border border-white/10 px-4 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-xs text-white/30">#{entry.position}</span>
              <NameCell entry={entry} />
            </div>
            {entry.promoted ? (
              <span className="text-xs text-green-400">Promoted</span>
            ) : (
              <button
                onClick={() => handlePromote(entry.position)}
                className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:border-white/40"
              >
                Promote
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
