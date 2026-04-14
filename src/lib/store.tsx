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

// ── Promotion types (moved from server-only promotions.ts) ──────────────
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
function loadFromStorage(): StudioState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed._version !== STORE_VERSION
    ) {
      return null;
    }

    if (
      !Array.isArray(parsed.classes) ||
      !Array.isArray(parsed.members) ||
      !Array.isArray(parsed.promotionEvents)
    ) {
      return null;
    }

    return parsed as StudioState;
  } catch {
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

// ── Promotion transform (pure, ported from promotions.ts) ───────────────

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

// ── Relative time formatting (ported from promotions.ts) ────────────────
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

// ── Context ─────────────────────────────────────────────────────────────
type StoreContextValue = {
  state: StudioState;
  /** Classes with promotion transforms applied */
  classesWithPromotions: StudioClass[];
  /** Get single class with promotions applied */
  getClassWithPromotions: (id: string) => StudioClass | undefined;
  /** Raw source class (for audit log name resolution) */
  getSourceClass: (id: string) => StudioClass | undefined;
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
      setState(stored);
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
