"use client";

import Link from "next/link";
import { StoreProvider } from "@/lib/store";

/**
 * v0.10.0 member-facing booking shell.
 *
 * Deliberately minimal. Member lands here with a URL in the form
 * /book/{slug} — no auth, no role check. The same un-gated pattern
 * the /checkin and /instructor shells use.
 *
 * This surface is read-only for everything the operator owns — it
 * reuses bookMember / cancelBooking from the shared store, which
 * route through the same sf_book_member / sf_cancel_booking server
 * paths the operator UI uses. No new booking logic lives here.
 */
export default function BookLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <StoreProvider>
      <div className="min-h-screen bg-black text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <Link
            href="/book"
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
