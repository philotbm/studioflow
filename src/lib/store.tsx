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
import type { Member, BookingAccess } from "@/app/app/members/data";
import {
  fetchAllClasses,
  fetchAllMembers,
  fetchBookingEventsForClass,
  bookMemberIntoClass as dbBook,
  cancelBooking as dbCancel,
  promoteWaitlistEntry,
  unpromoteEntry as dbUnpromote,
  checkInAttendee as dbCheckIn,
  adjustMemberCredit as dbAdjust,
  fetchRecentLedgerEntries as dbLedger,
  markAttendance as dbMarkAttendance,
  type AuditEvent,
  type LedgerEntry,
  type AdjustCreditResult,
  type ManualAdjustReason,
  type AttendanceOutcome,
  type MarkAttendanceResult,
} from "./db";

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
 * "waitlisted"; a call blocked by the server's eligibility check resolves
 * to "blocked" with the full BookingAccess payload so the UI can surface
 * the reason and action hint directly from the DB truth source.
 */
export type BookMemberResult =
  | { status: "booked"; alreadyExists?: boolean }
  | { status: "waitlisted"; alreadyExists?: boolean }
  | { status: "blocked"; access: BookingAccess };

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
  /** Book a member into a class (or add to waitlist). Server enforces eligibility. */
  bookMember: (classSlug: string, memberSlug: string) => Promise<BookMemberResult>;
  /** Cancel a booking or remove from waitlist */
  cancelBooking: (classSlug: string, memberSlug: string) => Promise<{ result: "cancelled" | "late_cancel" }>;
  /** Check in an attendee */
  checkInAttendee: (classSlug: string, memberSlug: string) => Promise<void>;
  /** Manually adjust a member's credit balance (v0.8.0). Reason code is required. */
  adjustCredit: (
    memberSlug: string,
    delta: number,
    reasonCode: ManualAdjustReason,
    note: string | null,
  ) => Promise<AdjustCreditResult>;
  /** Fetch recent credit-ledger rows for a member (v0.8.0). */
  getLedger: (memberSlug: string, limit?: number) => Promise<LedgerEntry[]>;
  /** v0.8.2: instructor attendance outcome (booked/attended/no_show). */
  markAttendance: (
    classSlug: string,
    memberSlug: string,
    outcome: AttendanceOutcome,
  ) => Promise<MarkAttendanceResult>;
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
      // v0.8.0: the server is the ONLY source of booking-access truth.
      // sf_book_member runs sf_check_eligibility inside its transaction
      // and returns { status: "blocked", ... } on rejection. The client
      // has no eligibility rules of its own.
      const result = await dbBook(classSlug, memberSlug);
      await loadData();
      if (result.status === "blocked") {
        const access: BookingAccess = {
          canBook: false,
          reason: result.reason,
          entitlementLabel: result.entitlementLabel,
          creditsRemaining: result.creditsRemaining,
          actionHint: result.actionHint,
          statusCode: result.statusCode,
        };
        return { status: "blocked", access };
      }
      return result;
    },
    [loadData],
  );

  const doAdjust = useCallback(
    async (
      memberSlug: string,
      delta: number,
      reasonCode: ManualAdjustReason,
      note: string | null,
    ): Promise<AdjustCreditResult> => {
      const result = await dbAdjust(memberSlug, delta, reasonCode, note);
      // Refresh so v_members_with_access re-materializes the new
      // credit balance and access state.
      await loadData();
      return result;
    },
    [loadData],
  );

  const getLedger = useCallback(
    (memberSlug: string, limit?: number) => dbLedger(memberSlug, limit),
    [],
  );

  const doMarkAttendance = useCallback(
    async (
      classSlug: string,
      memberSlug: string,
      outcome: AttendanceOutcome,
    ): Promise<MarkAttendanceResult> => {
      const result = await dbMarkAttendance(classSlug, memberSlug, outcome);
      // Refresh so both the operator class-detail page and the instructor
      // view pick up the new attendance state from the same store.
      await loadData();
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
      adjustCredit: doAdjust,
      getLedger,
      markAttendance: doMarkAttendance,
      refresh: loadData,
    }),
    [
      classes, members, loading, error, hydrated,
      getClass, getMember, getAuditEvents,
      doBook, doCancel, promoteEntry, doUnpromote, doCheckIn,
      doAdjust, getLedger, doMarkAttendance, loadData,
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
