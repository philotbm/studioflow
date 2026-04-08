"use client";

import { useState } from "react";
import type { WaitlistEntry } from "../data";

export default function WaitlistPanel({
  waitlist,
}: {
  waitlist: WaitlistEntry[];
}) {
  const [open, setOpen] = useState(false);
  const count = waitlist.length;

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="waitlist-list"
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-left hover:border-white/25 hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/80">Waitlist</span>
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-white/70">
            {count}
          </span>
        </span>
        <span className="flex items-center gap-2 text-xs text-white/40">
          {open ? "Hide" : "View"}
          <span
            aria-hidden
            className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </span>
      </button>

      {open && (
        <ol
          id="waitlist-list"
          className="mt-2 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.015] p-2"
        >
          {waitlist.map((entry) => (
            <li
              key={entry.position}
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-white/[0.03]"
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] text-white/60">
                  {entry.position}
                </span>
                <span className="text-sm text-white/80">{entry.name}</span>
              </span>
              <span className="text-xs text-white/30">waiting</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
