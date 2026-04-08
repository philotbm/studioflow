import { cookies } from "next/headers";
import type { Attendee, StudioClass, WaitlistEntry } from "./data";

// Cookie-backed promotion log. Each entry records that a given waitlist
// position on a given class has been promoted. The cookie lives in the user's
// browser so it survives reload, navigation, and production rebuilds of the
// (still seeded/static) source data.
export type Promotion = { classId: string; position: number };

const COOKIE_NAME = "sf_promotions_v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function isPromotion(value: unknown): value is Promotion {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promotion).classId === "string" &&
    typeof (value as Promotion).position === "number"
  );
}

export async function readPromotions(): Promise<Promotion[]> {
  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPromotion);
  } catch {
    return [];
  }
}

export async function writePromotions(promotions: Promotion[]): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, JSON.stringify(promotions), {
    path: "/",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
  });
}

// Pure transform: given the source-of-truth class and the set of active
// promotions, produce the effective class that should be rendered.
//
// - Promoted waitlist entries become `booked` attendees.
// - Promotions are capped at remaining capacity; any overflow stays on the
//   waitlist (so the class never exceeds capacity).
// - `booked` and `waitlistCount` are recomputed to match the transformed
//   roster, so the trust gap stays closed.
export function applyPromotionsToClass(
  cls: StudioClass,
  promotions: Promotion[],
): StudioClass {
  const forThis = promotions.filter((p) => p.classId === cls.id);
  if (forThis.length === 0) return cls;

  const waitlist = cls.waitlist ?? [];
  if (waitlist.length === 0) return cls;

  const promotedPositions = new Set(forThis.map((p) => p.position));
  const promoted = waitlist.filter((w) => promotedPositions.has(w.position));
  const remaining = waitlist.filter((w) => !promotedPositions.has(w.position));

  const spotsFree = Math.max(0, cls.capacity - cls.attendees.length);
  const toAccept = promoted.slice(0, spotsFree);
  const overflow = promoted.slice(spotsFree);

  const newAttendees: Attendee[] = [
    ...cls.attendees,
    ...toAccept.map<Attendee>((w) => ({
      name: w.name,
      memberId: w.memberId,
      status: "booked",
    })),
  ];

  const newWaitlist: WaitlistEntry[] = [...remaining, ...overflow].sort(
    (a, b) => a.position - b.position,
  );

  return {
    ...cls,
    attendees: newAttendees,
    waitlist: newWaitlist,
    booked: newAttendees.length,
    waitlistCount: newWaitlist.length,
  };
}

export async function applyPromotionsToClasses(
  classes: StudioClass[],
): Promise<StudioClass[]> {
  const promotions = await readPromotions();
  if (promotions.length === 0) return classes;
  return classes.map((c) => applyPromotionsToClass(c, promotions));
}
