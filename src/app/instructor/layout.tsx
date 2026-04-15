"use client";

import Link from "next/link";
import { StoreProvider } from "@/lib/store";

/**
 * Minimal instructor-facing shell. Deliberately spartan: no cross-links
 * to members/classes admin, no nav, no operator affordances. The
 * instructor should only ever see the single class they're about to run.
 *
 * v0.8.2 scope note: no auth layer, no role gating. Anyone who knows the
 * URL can reach this view. Auth + role gating come in a later release.
 */
export default function InstructorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <Link
            href="/instructor"
            className="text-sm font-medium tracking-wide text-white/80 hover:text-white"
          >
            StudioFlow Instructor
          </Link>
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
