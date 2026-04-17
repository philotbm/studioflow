/**
 * Canonical visible attendance language for StudioFlow, v0.8.3.
 *
 * Check-in is now the positive attendance truth:
 *   booked     — roster entry, no attendance marked
 *   checked_in — the member is physically present (via client, QR or
 *                instructor fallback)
 *   no_show    — the member did not attend (either auto-swept at
 *                class close or set via correction)
 *   late_cancel — the member cancelled after the cancellation window
 *                 closed; excluded from instructor roster
 *
 * "attended" is retired in v0.8.3. Any legacy rows carrying 'attended'
 * are normalised to 'checked_in' by the v0.8.3 migration. The client
 * mapper additionally maps any remaining 'attended' read to
 * 'checked_in' as a belt-and-suspenders safety.
 */
export type Attendee = {
  name: string;
  memberId?: string;
  status: "booked" | "checked_in" | "late_cancel" | "no_show";
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

/**
 * v0.8.4 — check-in window truth. Derived from classes.check_in_window_minutes
 * alongside lifecycle, so every UI surface shows the same gating. Lifecycle
 * stays temporal (where is the class relative to now), checkInStatus is
 * about whether the check-in door is open.
 *
 *   pre_window — now < starts_at - check_in_window_minutes. Too early.
 *                Client sees "Check-in opens at HH:MM".
 *   open       — we are inside the window. Client can self-check-in.
 *   closed     — class is completed. Fresh client check-in is blocked;
 *                staff correction is the only path from here.
 */
export type CheckInStatus = "pre_window" | "open" | "closed";

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
  // v0.8.4
  checkInStatus: CheckInStatus;
  checkInWindowMinutes: number;
  checkInOpensAt: string; // ISO timestamp (starts_at - window)
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
