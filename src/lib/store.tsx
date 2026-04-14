"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { StudioClass, Attendee, WaitlistEntry } from "@/app/app/classes/data";
import type { Member } from "@/app/app/members/data";
import { upcomingClasses } from "@/app/app/classes/data";
import { members as seedMembers } from "@/app/app/members/data";

// ── Promotion types ─────────────────────────────────────────────────────
export type PromotionEventAction = "promote" | "unpromote";

export type PromotionEvent = {
  classId: string;
  position: number;
  action: PromotionEventAction;
  at: number; // epoch ms
};

type Promotion = { classId: string; position: number };

// ── Schema version — bump when store shape changes ──────────────────────
const STORE_VERSION = 1;
const STORAGE_KEY = "studioflow_state_v1";

// ── Store shape ─────────────────────────────────────────────────────────
export type StudioState = {
  _version: number;
  classes: StudioClass[];
  members: Member[];
  promotionEvents: PromotionEvent[];
};

function defaultState(): StudioState {
  return {
    _version: STORE_VERSION,
    classes: structuredClone(upcomingClasses),
    members: structuredClone(seedMembers),
    promotionEvents: [],
  };
}

// ── Defensive hydration ─────────────────────────────────────────────────

function isValidClass(c: unknown): c is StudioClass {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.capacity === "number" &&
    typeof o.booked === "number" &&
    Array.isArray(o.attendees)
  );
}

function isValidMember(m: unknown): m is Member {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.plan === "string"
  );
}

function isValidPromotionEvent(e: unknown): e is PromotionEvent {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.classId === "string" &&
    typeof o.position === "number" &&
    (o.action === "promote" || o.action === "unpromote") &&
    typeof o.at === "number"
  );
}

function loadFromStorage(): StudioState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Version guard: discard if schema has changed
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed._version !== STORE_VERSION
    ) {
      // Clear corrupt/outdated data
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Structural checks
    if (
      !Array.isArray(parsed.classes) ||
      !Array.isArray(parsed.members) ||
      !Array.isArray(parsed.promotionEvents)
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Validate individual entries — reject entire store if any class/member is malformed
    if (!parsed.classes.every(isValidClass)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!parsed.members.every(isValidMember)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Filter out any malformed promotion events silently (append-only log can tolerate drops)
    const validEvents = parsed.promotionEvents.filter(isValidPromotionEvent);

    return { ...parsed, promotionEvents: validEvents } as StudioState;
  } catch {
    // JSON parse error or other — clear and reseed
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
}

function saveToStorage(state: StudioState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or private browsing — silently degrade
  }
}

// ── Promotion transform (pure) ──────────────────────────────────────────

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

function isCurrentlyPromoted(
  events: PromotionEvent[],
  classId: string,
  position: number,
): boolean {
  const forPair = events
    .filter((e) => e.classId === classId && e.position === position)
    .sort((a, b) => b.at - a.at);
  return forPair.length > 0 && forPair[0].action === "promote";
}

export function applyPromotionsToClass(
  cls: StudioClass,
  promotions: Promotion[],
): StudioClass {
  const waitlist = cls.waitlist ?? [];
  if (waitlist.length === 0) return cls;

  // Phase 1: manual promotions
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

  const remainingWaitlist: WaitlistEntry[] = [
    ...nonManualEntries,
    ...manualOverflow,
  ].sort((a, b) => a.position - b.position);

  // Phase 2: FIFO auto-promotion (upcoming only)
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

// ── Relative time formatting ────────────────────────────────────────────
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

// ── Prune stale promotion events ────────────────────────────────────────
// Remove events that reference classes no longer in the store (e.g. after
// a reseed or schema migration). Keeps the event log from growing unbounded.
function pruneStaleEvents(
  events: PromotionEvent[],
  classIds: Set<string>,
): PromotionEvent[] {
  return events.filter((e) => classIds.has(e.classId));
}

// ── Context ─────────────────────────────────────────────────────────────
type StoreContextValue = {
  state: StudioState;
  /** Classes with promotion transforms applied */
  classesWithPromotions: StudioClass[];
  /** Get single class with promotions applied */
  getClassWithPromotions: (id: string) => StudioClass | undefined;
  /** Raw source class (for audit log name resolution) */
  getSourceClass: (id: string) => StudioClass | undefined;
  /** Get a member by id from the persistent store */
  getMember: (id: string) => Member | undefined;
  /** Promote a waitlist entry */
  promoteEntry: (classId: string, position: number) => void;
  /** Unpromote a waitlist entry */
  unpromoteEntry: (classId: string, position: number) => void;
  /** Check in an attendee on a live class */
  checkInAttendee: (classId: string, attendeeIndex: number) => void;
  /** Update a member */
  updateMember: (id: string, updater: (m: Member) => Member) => void;
  /** Reset all state to seed defaults */
  resetStore: () => void;
  hydrated: boolean;
};

const StoreContext = createContext<StoreContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      // Prune stale promotion events on load
      const classIds = new Set(stored.classes.map((c) => c.id));
      const pruned = pruneStaleEvents(stored.promotionEvents, classIds);
      if (pruned.length !== stored.promotionEvents.length) {
        setState({ ...stored, promotionEvents: pruned });
      } else {
        setState(stored);
      }
    }
    setHydrated(true);
  }, []);

  // Persist on every state change after hydration
  useEffect(() => {
    if (hydrated) {
      saveToStorage(state);
    }
  }, [state, hydrated]);

  // Derive promotion-transformed classes
  const activePromotions = useMemo(
    () => deriveActivePromotions(state.promotionEvents),
    [state.promotionEvents],
  );

  const classesWithPromotions = useMemo(
    () => state.classes.map((c) => applyPromotionsToClass(c, activePromotions)),
    [state.classes, activePromotions],
  );

  const getClassWithPromotions = useCallback(
    (id: string) => classesWithPromotions.find((c) => c.id === id),
    [classesWithPromotions],
  );

  const getSourceClass = useCallback(
    (id: string) => state.classes.find((c) => c.id === id),
    [state.classes],
  );

  const getMember = useCallback(
    (id: string) => state.members.find((m) => m.id === id),
    [state.members],
  );

  const promoteEntry = useCallback(
    (classId: string, position: number) => {
      setState((prev) => {
        if (isCurrentlyPromoted(prev.promotionEvents, classId, position)) {
          return prev; // no-op
        }
        return {
          ...prev,
          promotionEvents: [
            ...prev.promotionEvents,
            { classId, position, action: "promote" as const, at: Date.now() },
          ],
        };
      });
    },
    [],
  );

  const unpromoteEntry = useCallback(
    (classId: string, position: number) => {
      setState((prev) => {
        if (!isCurrentlyPromoted(prev.promotionEvents, classId, position)) {
          return prev; // no-op
        }
        return {
          ...prev,
          promotionEvents: [
            ...prev.promotionEvents,
            { classId, position, action: "unpromote" as const, at: Date.now() },
          ],
        };
      });
    },
    [],
  );

  const checkInAttendee = useCallback(
    (classId: string, attendeeIndex: number) => {
      setState((prev) => ({
        ...prev,
        classes: prev.classes.map((c) =>
          c.id === classId
            ? {
                ...c,
                attendees: c.attendees.map((a, i) =>
                  i === attendeeIndex
                    ? { ...a, status: "checked_in" as const }
                    : a,
                ),
              }
            : c,
        ),
      }));
    },
    [],
  );

  const updateMember = useCallback(
    (id: string, updater: (m: Member) => Member) => {
      setState((prev) => ({
        ...prev,
        members: prev.members.map((m) => (m.id === id ? updater(m) : m)),
      }));
    },
    [],
  );

  const resetStore = useCallback(() => {
    const fresh = defaultState();
    setState(fresh);
    saveToStorage(fresh);
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      classesWithPromotions,
      getClassWithPromotions,
      getSourceClass,
      getMember,
      promoteEntry,
      unpromoteEntry,
      checkInAttendee,
      updateMember,
      resetStore,
      hydrated,
    }),
    [
      state,
      classesWithPromotions,
      getClassWithPromotions,
      getSourceClass,
      getMember,
      promoteEntry,
      unpromoteEntry,
      checkInAttendee,
      updateMember,
      resetStore,
      hydrated,
    ],
  );

  return <StoreContext value={value}>{children}</StoreContext>;
}

// ── Hooks ───────────────────────────────────────────────────────────────
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}

export function useClasses(): StudioClass[] {
  return useStore().classesWithPromotions;
}

export function useClass(id: string): StudioClass | undefined {
  return useStore().getClassWithPromotions(id);
}

export function useMembers(): Member[] {
  return useStore().state.members;
}

export function useMember(id: string): Member | undefined {
  return useStore().state.members.find((m) => m.id === id);
}
