"use client";

import Link from "next/link";
import { StoreProvider } from "@/lib/store";

/**
 * v0.8.3 client check-in shell.
 *
 * Minimal by design: no nav, no member list, no operator surfaces.
 * The member lands here either by scanning the class QR code or by
 * navigating directly to /checkin/classes/[id]. They pick their
 * name from the booked roster, confirm, and are checked in.
 *
 * No auth and no role gating in this release (explicit scope note
 * in the v0.8.3 constraints). Anyone with the URL can self-check-in
 * against the booked roster, but sf_check_in server-side rejects
 * non-booked members, waitlist entries, duplicates, and any call
 * outside the live window.
 */
export default function CheckInLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <Link
            href="/checkin"
            className="text-sm font-medium tracking-wide text-white/80 hover:text-white"
          >
            StudioFlow Check-in
          </Link>
        </header>
        <div className="px-6 py-8">{children}</div>
      </div>
    </StoreProvider>
  );
}
