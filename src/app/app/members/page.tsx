"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import type { Member } from "./data";
import {
  summariseMembership,
  shortStatusLabel,
  accessTypeLabel,
  type MembershipTone,
} from "@/lib/memberships";

const toneColor: Record<MembershipTone, string> = {
  positive: "text-green-400",
  neutral: "text-white/50",
  attention: "text-amber-400",
  blocked: "text-red-400",
};

const toneBorder: Record<MembershipTone, string> = {
  positive: "border-green-400/20",
  neutral: "border-white/10",
  attention: "border-amber-400/30",
  blocked: "border-red-400/30",
};

function MemberRow({ m }: { m: Member }) {
  const summary = summariseMembership(m);
  const short = shortStatusLabel(summary);
  const accessLabel = accessTypeLabel(summary);
  return (
    <Link
      href={`/app/members/${m.id}`}
      className="flex flex-col gap-1.5 rounded-lg border border-white/10 px-4 py-3 hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{m.name}</span>
        <span className="text-xs text-white/50">{m.plan}</span>
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${toneBorder[summary.tone]} ${toneColor[summary.tone]}`}
        >
          {accessLabel}
        </span>
        <span className={`text-xs ${toneColor[summary.tone]}`}>{short}</span>
      </div>
    </Link>
  );
}

export default function MembersPage() {
  const { members, loading, error } = useStore();

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-white/40">Loading members...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-red-400 text-sm">Failed to load data. Check configuration.</p>
        <p className="text-white/30 text-xs mt-2">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add member
        </button>
      </div>

      <p className="mt-2 text-xs text-white/40">
        Access type and credit state are derived from each member&apos;s current
        plan. The dot next to the plan pill reflects booking eligibility.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {members.map((m) => (
          <li key={m.id}>
            <MemberRow m={m} />
          </li>
        ))}
      </ul>
    </main>
  );
}
