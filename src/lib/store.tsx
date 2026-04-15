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
import type { StudioClass } from "@/app/app/classes/data";
import type { Member } from "@/app/app/members/data";
import {
  fetchAllClasses,
  fetchAllMembers,
  fetchBookingEventsForClass,
  bookMemberIntoClass as dbBook,
  cancelBooking as dbCancel,
  promoteWaitlistEntry,
  unpromoteEntry as dbUnpromote,
  checkInAttendee as dbCheckIn,
  type AuditEvent,
} from "./db";
import { type EligibilityResult } from "./eligibility";

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

// ── Context ─────────────────────────────────────────────────────────────
/**
 * Result of a bookMember call. A successful call resolves to "booked" or
 * "waitlisted"; a call blocked by the v0.6.0 eligibility engine resolves to
 * "blocked" with the full EligibilityResult so the UI can show the reason.
 */
export type BookMemberResult =
  | { status: "booked"; alreadyExists?: boolean }
  | { status: "waitlisted"; alreadyExists?: boolean }
  | { status: "blocked"; eligibility: EligibilityResult };

type StoreContextValue = {
  classes: StudioClass[];
  members: Member[];
  loading: boolean;
  error: string | null;
  hydrated: boolean;
  /** Get single class by slug */
  getClass: (slug: string) => StudioClass | undefined;
  /** Get a member by slug from the store */
  getMember: (slug: string) => Member | undefined;
  /** Fetch audit events for a class */
  getAuditEvents: (classSlug: string) => Promise<AuditEvent[]>;
  /** Promote a waitlist entry (manual) */
  promoteEntry: (classSlug: string, memberSlug: string) => Promise<void>;
  /** Unpromote a manually-promoted entry */
  unpromoteEntry: (classSlug: string, memberSlug: string, originalPosition: number) => Promise<void>;
  /** Book a member into a class (or add to waitlist). Runs eligibility engine first. */
  bookMember: (classSlug: string, memberSlug: string) => Promise<BookMemberResult>;
  /** Cancel a booking or remove from waitlist */
  cancelBooking: (classSlug: string, memberSlug: string) => Promise<{ result: "cancelled" | "late_cancel" }>;
  /** Check in an attendee */
  checkInAttendee: (classSlug: string, memberSlug: string) => Promise<void>;
  /** Re-fetch all data from Supabase */
  refresh: () => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────
export function StoreProvider({ children }: { children: ReactNode }) {
  const [classes, setClasses] = useState<StudioClass[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [cls, mem] = await Promise.all([
        fetchAllClasses(),
        fetchAllMembers(),
      ]);
      setClasses(cls);
      setMembers(mem);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load data";
      console.error("[StudioFlow Store] Load failed:", msg);
      setError(msg);
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getClass = useCallback(
    (slug: string) => classes.find((c) => c.id === slug),
    [classes],
  );

  const getMember = useCallback(
    (slug: string) => members.find((m) => m.id === slug),
    [members],
  );

  const getAuditEvents = useCallback(
    (classSlug: string) => fetchBookingEventsForClass(classSlug),
    [],
  );

  const promoteEntry = useCallback(
    async (classSlug: string, memberSlug: string) => {
      await promoteWaitlistEntry(classSlug, memberSlug);
      await loadData();
    },
    [loadData],
  );

  const doUnpromote = useCallback(
    async (classSlug: string, memberSlug: string, originalPosition: number) => {
      await dbUnpromote(classSlug, memberSlug, originalPosition);
      await loadData();
    },
    [loadData],
  );

  const doBook = useCallback(
    async (classSlug: string, memberSlug: string): Promise<BookMemberResult> => {
      // v0.7.0: The SERVER is the economic truth-source. We no longer
      // pre-check on the client — sf_book_member enforces eligibility
      // inside its transaction and can reply with { status: "blocked" }.
      // eligibility.ts is still used elsewhere for UI previews (dropdown
      // labels, member detail access card) but never as a gate.
      const result = await dbBook(classSlug, memberSlug);
      // Always refresh after a booking attempt so credits_remaining,
      // attendee rosters and waitlist positions reflect the new server state.
      await loadData();
      if (result.status === "blocked") {
        // Rebuild a full EligibilityResult from the server fields so the
        // existing UI (class-detail + member-detail) doesn't need to care
        // whether the block came from the client preview or the DB.
        const eligibility: EligibilityResult = {
          canBook: false,
          reason: result.reason,
          entitlementLabel: result.entitlementLabel,
          creditsRemaining: result.creditsRemaining,
          actionHint: result.actionHint,
        };
        return { status: "blocked", eligibility };
      }
      return result;
    },
    [loadData],
  );

  const doCancel = useCallback(
    async (classSlug: string, memberSlug: string) => {
      const result = await dbCancel(classSlug, memberSlug);
      await loadData();
      return result;
    },
    [loadData],
  );

  const doCheckIn = useCallback(
    async (classSlug: string, memberSlug: string) => {
      await dbCheckIn(classSlug, memberSlug);
      await loadData();
    },
    [loadData],
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      classes,
      members,
      loading,
      error,
      hydrated,
      getClass,
      getMember,
      getAuditEvents,
      bookMember: doBook,
      cancelBooking: doCancel,
      promoteEntry,
      unpromoteEntry: doUnpromote,
      checkInAttendee: doCheckIn,
      refresh: loadData,
    }),
    [
      classes, members, loading, error, hydrated,
      getClass, getMember, getAuditEvents,
      doBook, doCancel, promoteEntry, doUnpromote, doCheckIn, loadData,
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
  return useStore().classes;
}

export function useClass(slug: string): StudioClass | undefined {
  return useStore().getClass(slug);
}

export function useMembers(): Member[] {
  return useStore().members;
}

export function useMember(slug: string): Member | undefined {
  return useStore().getMember(slug);
}
