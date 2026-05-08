"use client";

import Link from "next/link";
import { StoreProvider } from "@/lib/store";
import type { StaffRow } from "@/lib/auth";

/**
 * v0.21.0 — client shell for /instructor/*. Spartan by design (per
 * the original v0.8.2 layout note): an instructor running a class
 * shouldn't see member admin or operator nav. Adds the role
 * indicator + sign-out link in the header trim, nothing else.
 */
export function InstructorShell({
  staff,
  children,
}: {
  staff: StaffRow | null;
  children: React.ReactNode;
}) {
  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
          <Link
            href="/instructor"
            className="text-sm font-medium tracking-wide text-white/80 hover:text-white"
          >
            StudioFlow Instructor
          </Link>
          <div className="flex items-center gap-3 text-xs text-white/50">
            {staff ? (
              <span>
                Signed in as{" "}
                <span className="text-white/80">{staff.full_name}</span> (
                {staff.role})
              </span>
            ) : (
              <span>Signed in</span>
            )}
            <Link
              href="/auth/signout?intent=staff"
              className="text-white/50 hover:text-white/80"
            >
              Sign out
            </Link>
          </div>
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
