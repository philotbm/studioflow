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
  promoteWaitlistEntry,
  unpromoteEntry as dbUnpromote,
  checkInAttendee as dbCheckIn,
  type AuditEvent,
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
      promoteEntry,
      unpromoteEntry: doUnpromote,
      checkInAttendee: doCheckIn,
      refresh: loadData,
    }),
    [
      classes, members, loading, error, hydrated,
      getClass, getMember, getAuditEvents,
      promoteEntry, doUnpromote, doCheckIn, loadData,
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
