"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { qaFixtureFor } from "@/lib/db";
import type { Attendee } from "@/app/app/classes/data";
import QaFixtureBanner from "@/app/qa/QaFixtureBanner";

/**
 * v0.8.4 client check-in page.
 *
 * Reachable by:
 *   - scanning the class QR code (rendered on the instructor view)
 *   - direct URL navigation on a member's phone / browser
 *
 * The page renders one of five mutually exclusive states:
 *
 *   1. too early           — class is in the future, outside the window
 *                            ("Check-in opens at HH:MM")
 *   2. check-in open       — inside the window; roster with tappable rows
 *   3. already checked in  — idempotent success (repeat scan / tap)
 *   4. class closed        — class ended; staff correction only
 *   5. not found           — invalid slug
 *
 * The DB is the authoritative gate. sf_check_in re-evaluates every
 * rule server-side and returns structured rejections — this page just
 * renders the right UI state from them.
 */

type RosterRow = {
  name: string;
  memberId: string;
  status: Attendee["status"];
};

const STATUS_LABEL: Record<Attendee["status"], string> = {
  booked: "Booked",
  checked_in: "Checked in",
  no_show: "No-show",
  late_cancel: "Late cancel",
};

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function CheckInClass({ id }: { id: string }) {
  const { getClass, checkInMember, hydrated, error: storeError } = useStore();
  const cls = getClass(id);
  const isQaFixture = qaFixtureFor(id) !== null;

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  type Result =
    | { kind: "ok"; name: string; alreadyCheckedIn: boolean }
    | { kind: "gated"; code: "too_early" | "closed" | "not_booked"; message: string; opensAt?: string }
    | { kind: "error"; message: string };
  const [result, setResult] = useState<Result | null>(null);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={id} />
        <p className="pt-12 text-center text-white/40">Loading class...</p>
      </main>
    );
  }

  if (storeError) {
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={id} />
        <p className="pt-12 text-center text-sm text-red-400/90">
          Could not load class data.
        </p>
        <p className="mt-2 text-center text-xs text-white/30">{storeError}</p>
      </main>
    );
  }

  if (!cls) {
    // v0.8.4.2: distinguish "QA fixture not seeded" from a genuine
    // "no such class" so testers don't chase ghosts when the /qa
    // refresh hasn't run yet. Non-QA slugs keep the original message.
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={id} missing={isQaFixture} />
        {!isQaFixture && (
          <p className="pt-12 text-center text-sm text-white/60">
            Class not found.
          </p>
        )}
      </main>
    );
  }

  // ── State 1: too early (pre-window) ────────────────────────────────
  if (cls.checkInStatus === "pre_window") {
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={cls.id} />
        <h1 className="text-xl font-semibold">{cls.name}</h1>
        <p className="mt-1 text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </p>
        <div className="mt-6 rounded border border-white/10 px-4 py-4 text-sm text-white/70">
          Check-in isn&apos;t open yet.
          <p className="mt-2 text-xs text-white/40">
            Opens at {formatClockTime(cls.checkInOpensAt)} —
            {" "}
            {cls.checkInWindowMinutes} min before class start.
          </p>
        </div>
      </main>
    );
  }

  // ── State 4: class closed ──────────────────────────────────────────
  if (cls.checkInStatus === "closed") {
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={cls.id} />
        <h1 className="text-xl font-semibold">{cls.name}</h1>
        <p className="mt-1 text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </p>
        <div className="mt-6 rounded border border-white/10 px-4 py-4 text-sm text-white/70">
          This class has ended — check-in is closed.
          <p className="mt-2 text-xs text-white/40">
            If this looks wrong, ask your instructor to correct it on their end.
          </p>
        </div>
      </main>
    );
  }

  // ── State 2: check-in open — show the roster ───────────────────────
  const roster: RosterRow[] = [];
  for (const a of cls.attendees) {
    if (a.status === "late_cancel") continue;
    if (!a.memberId) continue; // drop-in stubs without a slug can't self-check-in
    roster.push({ name: a.name, memberId: a.memberId, status: a.status });
  }

  async function handleCheckIn(row: RosterRow) {
    setSelectedSlug(row.memberId);
    setBusy(true);
    setResult(null);
    try {
      const outcome = await checkInMember(cls!.id, row.memberId, "client");
      if (outcome.ok) {
        setResult({
          kind: "ok",
          name: row.name,
          alreadyCheckedIn: outcome.alreadyCheckedIn,
        });
      } else {
        setResult({
          kind: "gated",
          code: outcome.code,
          message: outcome.message,
          opensAt: outcome.opensAt,
        });
      }
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : "Check-in failed",
      });
    } finally {
      setBusy(false);
    }
  }

  // ── State 3: already-checked-in or ok success ──────────────────────
  if (result?.kind === "ok") {
    return (
      <main className="mx-auto max-w-md">
        <QaFixtureBanner classSlug={cls.id} />
        <h1 className="text-xl font-semibold">{cls.name}</h1>
        <p className="mt-1 text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </p>
        <div className="mt-6 rounded border border-green-400/30 bg-green-400/5 px-4 py-5 text-center">
          <p className="text-lg font-semibold text-green-300">
            {result.alreadyCheckedIn
              ? "✓ You’re already checked in"
              : "✓ You’re checked in"}
          </p>
          <p className="mt-1 text-xs text-white/60">
            {result.alreadyCheckedIn
              ? `No changes made, ${result.name}. Enjoy the class.`
              : `Welcome, ${result.name}. Enjoy the class.`}
          </p>
        </div>
      </main>
    );
  }

  // Inline feedback banner for gated rejection / error while still
  // showing the roster so the member can retry or pick a different row.
  const banner = (() => {
    if (!result) return null;
    if (result.kind === "gated") {
      const label =
        result.code === "too_early"
          ? result.opensAt
            ? `Check-in opens at ${formatClockTime(result.opensAt)}`
            : "Check-in is not open yet"
          : result.code === "closed"
            ? "Class has ended — check-in is closed"
            : "You’re not booked into this class — ask an instructor";
      return (
        <p className="mt-3 rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
          {label}
        </p>
      );
    }
    if (result.kind === "error") {
      return (
        <p className="mt-3 rounded border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-400/90">
          {result.message}
        </p>
      );
    }
    return null;
  })();

  return (
    <main className="mx-auto max-w-md">
      <QaFixtureBanner classSlug={cls.id} />
      <h1 className="text-xl font-semibold">{cls.name}</h1>
      <p className="mt-1 flex items-center gap-2 text-xs text-white/50">
        <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 px-2 py-0.5 text-[11px] text-green-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
          Check-in open
        </span>
        <span>
          {cls.time} · {cls.instructor}
        </span>
      </p>

      <p className="mt-4 text-sm text-white/70">Tap your name to check in.</p>
      {banner}
      <ul className="mt-4 flex flex-col gap-2">
        {roster.length === 0 && (
          <li className="rounded border border-white/10 px-4 py-3 text-xs text-white/40">
            No booked members on this class.
          </li>
        )}
        {roster.map((r) => {
          const isThisBusy = busy && selectedSlug === r.memberId;
          const alreadyCheckedIn = r.status === "checked_in";
          const noShow = r.status === "no_show";
          return (
            <li key={r.memberId}>
              <button
                onClick={() => handleCheckIn(r)}
                disabled={busy || noShow}
                className={`flex w-full items-center justify-between rounded border px-4 py-3 text-left transition-colors ${
                  alreadyCheckedIn
                    ? "border-green-400/40 bg-green-400/5 text-green-300"
                    : noShow
                      ? "border-red-400/20 text-red-400/70"
                      : "border-white/15 text-white/90 hover:border-white/40 hover:bg-white/5"
                } disabled:cursor-not-allowed`}
                title={
                  noShow
                    ? "Marked as no-show — ask your instructor to correct"
                    : alreadyCheckedIn
                      ? "Already checked in — tap to confirm"
                      : undefined
                }
              >
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs">
                  {isThisBusy
                    ? "…"
                    : alreadyCheckedIn
                      ? "✓ Checked in"
                      : STATUS_LABEL[r.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
