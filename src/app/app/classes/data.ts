/**
 * Canonical visible attendance language for StudioFlow, v0.8.2.1.
 *
 * Exactly five states — no derived "checked_in"/"not_checked_in" overlays.
 * The check-in concept (QR / client check-in) is deferred to v0.8.3+ and
 * is not a first-class attendance state in this phase. The visible
 * language across operator and instructor views must be drawn only from
 * this union to avoid drift between surfaces.
 */
export type Attendee = {
  name: string;
  memberId?: string;
  status: "booked" | "attended" | "late_cancel" | "no_show";
  // Set by the promotions transform when an attendee was lifted off the
  // waitlist. Preserves the original waitlist position so the Unpromote
  // action can revert cleanly.
  promotedFromPosition?: number;
  // How the promotion happened:
  //   "manual" — recorded in the audit log via promoteWaitlistEntry
  //   "auto"   — derived every render by the FIFO auto-promotion pass,
  //              never written to the audit log, has no Undo action
  promotionType?: "manual" | "auto";
};

export type Lifecycle = "upcoming" | "live" | "completed";

export type WaitlistEntry = {
  name: string;
  memberId?: string;
  position: number;
};

export type StudioClass = {
  id: string;
  name: string;
  time: string;
  instructor: string;
  booked: number;
  capacity: number;
  waitlistCount: number;
  lifecycle: Lifecycle;
  cancellationWindowClosed?: boolean;
  attendees: Attendee[];
  waitlist?: WaitlistEntry[];
};

// Seed data removed in v0.4.8 — Supabase is now the source of truth.
// Keeping a static reference for generateStaticParams fallback.
export const seedClassSlugs = [
  "reformer-mon-9",
  "spin-mon-1230",
  "yoga-tue-7",
  "hiit-tue-1800",
  "barre-wed-10",
  "reformer-thu-9",
];
