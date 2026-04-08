import { cookies } from "next/headers";
import type { Attendee, StudioClass, WaitlistEntry } from "./data";

// v0.4.3 — append-only promotion event log.
//
// The cookie stores a chronological list of `PromotionEvent`s per
// `(classId, position)` pair. The current set of *active* promotions (i.e.
// who is currently lifted off the waitlist) is derived by taking the latest
// event per pair and keeping only the ones whose latest action is `promote`.
//
// This is a minimal, justified refinement of the v0.4.2 model (which stored
// only the active promotion snapshot). The audit surface on the class detail
// page needs the history of actions — not just the current state — so the
// storage shape has to be an event log. Persistence semantics are unchanged:
// everything still lives in the user's browser cookie, so it survives
// reloads, navigation, and production rebuilds of the seeded data.
export type PromotionEventAction = "promote" | "unpromote";

export type PromotionEvent = {
  classId: string;
  position: number;
  action: PromotionEventAction;
  at: number; // epoch ms
};

// Derived snapshot used by the transform.
export type Promotion = { classId: string; position: number };

const COOKIE_NAME = "sf_promotion_events_v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function isEvent(value: unknown): value is PromotionEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<PromotionEvent>;
  return (
    typeof e.classId === "string" &&
    typeof e.position === "number" &&
    (e.action === "promote" || e.action === "unpromote") &&
    typeof e.at === "number"
  );
}

export async function readPromotionEvents(): Promise<PromotionEvent[]> {
  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvent);
  } catch {
    return [];
  }
}

export async function writePromotionEvents(
  events: PromotionEvent[],
): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, JSON.stringify(events), {
    path: "/",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
  });
}

// Derive the current active promotions by folding the event log: for every
// (classId, position) pair, the most recent event wins.
export function deriveActivePromotions(
  events: PromotionEvent[],
): Promotion[] {
  const latest = new Map<string, PromotionEvent>();
  for (const ev of [...events].sort((a, b) => a.at - b.at)) {
    latest.set(`${ev.classId}:${ev.position}`, ev);
  }
  const active: Promotion[] = [];
  for (const ev of latest.values()) {
    if (ev.action === "promote") {
      active.push({ classId: ev.classId, position: ev.position });
    }
  }
  return active;
}

// Used by server actions to no-op when the caller's intent matches the
// already-current state (e.g. clicking Promote twice).
export function isCurrentlyPromoted(
  events: PromotionEvent[],
  classId: string,
  position: number,
): boolean {
  const forPair = events
    .filter((e) => e.classId === classId && e.position === position)
    .sort((a, b) => b.at - a.at);
  return forPair.length > 0 && forPair[0].action === "promote";
}

// Pure transform: given the source-of-truth class and the active set of
// manual promotions (derived from the cookie event log), produce the
// effective class that should be rendered.
//
// This runs in two phases — in order — so that manual operator intent
// always wins over FIFO defaults:
//
//   Phase 1 — Manual promotions
//     Apply every waitlist entry that has an active manual `promote` event.
//     Manual promotions are capped by capacity; any manual overflow stays on
//     the waitlist to be picked up later. Accepted entries are tagged with
//     `promotionType: "manual"` so the UI shows the Promoted badge + Undo.
//
//   Phase 2 — FIFO auto-promotion
//     While the class still has free capacity AND there are non-manual
//     waitlist entries, auto-promote the next one in queue order (lowest
//     position first). Accepted entries are tagged with
//     `promotionType: "auto"`, which the UI renders as a softer "Auto" badge
//     and does NOT offer Undo for — auto-promotion is a pure derivation and
//     is never written to the cookie.
//
//   - Only applies to `lifecycle === "upcoming"` classes. Live and completed
//     classes are never auto-promoted (they represent decided state).
//   - `booked` and `waitlistCount` are recomputed from the transformed
//     roster, so the trust gap stays closed and the class can never exceed
//     its capacity.
export function applyPromotionsToClass(
  cls: StudioClass,
  promotions: Promotion[],
): StudioClass {
  const waitlist = cls.waitlist ?? [];
  if (waitlist.length === 0) return cls;

  // --- Phase 1: manual promotions ---
  const manualPositions = new Set(
    promotions.filter((p) => p.classId === cls.id).map((p) => p.position),
  );
  const manualEntries = waitlist.filter((w) => manualPositions.has(w.position));
  const nonManualEntries = waitlist.filter(
    (w) => !manualPositions.has(w.position),
  );

  const spotsBeforeManual = Math.max(0, cls.capacity - cls.attendees.length);
  const manualAccept = manualEntries.slice(0, spotsBeforeManual);
  const manualOverflow = manualEntries.slice(spotsBeforeManual);

  const attendees: Attendee[] = [
    ...cls.attendees,
    ...manualAccept.map<Attendee>((w) => ({
      name: w.name,
      memberId: w.memberId,
      status: "booked",
      promotedFromPosition: w.position,
      promotionType: "manual",
    })),
  ];

  // Remaining waitlist after manual pass, always in queue order.
  const remainingWaitlist: WaitlistEntry[] = [
    ...nonManualEntries,
    ...manualOverflow,
  ].sort((a, b) => a.position - b.position);

  // --- Phase 2: FIFO auto-promotion ---
  // Only for upcoming classes; live/completed classes never auto-fill.
  if (cls.lifecycle === "upcoming") {
    while (
      attendees.length < cls.capacity &&
      remainingWaitlist.length > 0
    ) {
      const next = remainingWaitlist.shift();
      if (!next) break;
      attendees.push({
        name: next.name,
        memberId: next.memberId,
        status: "booked",
        promotedFromPosition: next.position,
        promotionType: "auto",
      });
    }
  }

  return {
    ...cls,
    attendees,
    waitlist: remainingWaitlist,
    booked: attendees.length,
    waitlistCount: remainingWaitlist.length,
  };
}

export async function applyPromotionsToClasses(
  classes: StudioClass[],
): Promise<StudioClass[]> {
  // Always run the transform — even with zero active manual promotions,
  // phase 2 (FIFO auto-promote) may still fire and change the rendered
  // booked/waitlist counts on the list cards.
  const events = await readPromotionEvents();
  const active = deriveActivePromotions(events);
  return classes.map((c) => applyPromotionsToClass(c, active));
}

// Plain helper — not a React component — so the `Date.now()` call here
// isn't subject to React's purity rules. Used by the class detail page to
// capture a single wall-clock reading per request for relative-time display
// in the audit log.
export async function readPromotionEventsWithClock(): Promise<{
  events: PromotionEvent[];
  now: number;
}> {
  const events = await readPromotionEvents();
  return { events, now: Date.now() };
}

// Compact, operator-friendly relative time for the audit surface.
export function formatRelative(atMs: number, nowMs: number = Date.now()): string {
  const deltaMs = Math.max(0, nowMs - atMs);
  const s = Math.floor(deltaMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
