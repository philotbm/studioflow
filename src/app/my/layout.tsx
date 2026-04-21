"use client";

import Link from "next/link";
import { StoreProvider } from "@/lib/store";

/**
 * v0.11.0 Member Home shell.
 *
 * The member-facing surface lives under /my. Each member reaches their
 * home at /my/{memberSlug} — one personal URL per member. No auth in
 * this phase; same posture as /checkin and /instructor.
 *
 * This layout deliberately keeps the chrome minimal. When v0.11.x grows
 * member sub-sections (class history, plan details, perks, etc.), they
 * will attach under /my/{memberSlug}/... and nav items appear here.
 * For v0.11.0 the header is a simple StudioFlow brand mark + a Member
 * role tag.
 */
export default function MyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <Link
            href="/"
            className="text-sm font-medium tracking-wide text-white/80 hover:text-white"
          >
            StudioFlow
          </Link>
          <span className="text-xs uppercase tracking-wide text-white/40">
            Member
          </span>
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
