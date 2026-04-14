"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import type { Member } from "./data";

function creditDisplay(member: Member) {
  if (member.credits === null) return { text: "Unlimited", style: "text-green-400" };
  if (member.credits === 0) return { text: "No credits", style: "text-red-400" };
  if (member.credits === 1) return { text: "1 credit left", style: "text-amber-400" };
  return { text: `${member.credits} credits`, style: "text-white/50" };
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

      <ul className="mt-6 flex flex-col gap-3">
        {members.map((m) => {
          const credit = creditDisplay(m);
          return (
            <li key={m.id}>
              <Link
                href={`/app/members/${m.id}`}
                className="flex flex-col gap-1 rounded-lg border border-white/10 px-4 py-3 hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-white/50">{m.plan}</span>
                </div>
                <span className={`mt-1 text-xs sm:mt-0 ${credit.style}`}>
                  {credit.text}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
