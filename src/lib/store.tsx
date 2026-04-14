"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { StudioClass } from "@/app/app/classes/data";
import type { Member } from "@/app/app/members/data";
import { seedClasses } from "@/app/app/classes/data";
import { seedMembers } from "@/app/app/members/data";

// ── Schema version — bump when store shape changes ──────────────────────
const STORE_VERSION = 1;
const STORAGE_KEY = "studioflow_state";

// ── Store shape ─────────────────────────────────────────────────────────
export type StudioState = {
  _version: number;
  classes: StudioClass[];
  members: Member[];
};

function defaultState(): StudioState {
  return {
    _version: STORE_VERSION,
    classes: structuredClone(seedClasses),
    members: structuredClone(seedMembers),
  };
}

// ── Defensive hydration ─────────────────────────────────────────────────
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
      return null;
    }

    // Structural checks
    if (!Array.isArray(parsed.classes) || !Array.isArray(parsed.members)) {
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

// ── Context ─────────────────────────────────────────────────────────────
type StoreContextValue = {
  state: StudioState;
  updateClass: (id: string, updater: (cls: StudioClass) => StudioClass) => void;
  updateMember: (id: string, updater: (m: Member) => Member) => void;
  resetStore: () => void;
  hydrated: boolean;
};

const StoreContext = createContext<StoreContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Hydrate from localStorage on mount (client only)
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

  const updateClass = useCallback(
    (id: string, updater: (cls: StudioClass) => StudioClass) => {
      setState((prev) => ({
        ...prev,
        classes: prev.classes.map((c) => (c.id === id ? updater(c) : c)),
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

  return (
    <StoreContext value={{ state, updateClass, updateMember, resetStore, hydrated }}>
      {children}
    </StoreContext>
  );
}

// ── Hooks ───────────────────────────────────────────────────────────────
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}

export function useClasses(): StudioClass[] {
  return useStore().state.classes;
}

export function useClass(id: string): StudioClass | undefined {
  return useStore().state.classes.find((c) => c.id === id);
}

export function useMembers(): Member[] {
  return useStore().state.members;
}

export function useMember(id: string): Member | undefined {
  return useStore().state.members.find((m) => m.id === id);
}
