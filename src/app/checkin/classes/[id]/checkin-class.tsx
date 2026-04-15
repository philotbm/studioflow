"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Attendee } from "@/app/app/classes/data";

/**
 * v0.8.3 client check-in page.
 *
 * Reachable by:
 *   - scanning the class QR code (rendered on the instructor view)
 *   - direct URL navigation on a member's phone / browser
 *
 * The same page serves both paths — QR and "app check-in" converge on
 * the same React component and the same sf_check_in RPC. No auth, no
 * role gating; validation happens server-side via sf_check_in, which
 * enforces the full rule set:
 *   - class must be live (upcoming/completed rejected)
 *   - member must be actively booked (waitlist/cancelled/late_cancel/
 *     not-booked all rejected with the same operator-safe message)
 *   - already-checked-in is rejected as a duplicate
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

export default function CheckInClass({ id }: { id: string }) {
  const { getClass, checkInMember, loading, error: storeError } = useStore();
  const cls = getClass(id);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; name: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  if (loading && !cls) {
    return (
      <main className="mx-auto max-w-md pt-12 text-center">
        <p className="text-white/40">Loading class...</p>
      </main>
    );
  }

  if (storeError) {
    return (
      <main className="mx-auto max-w-md pt-12 text-center">
        <p className="text-sm text-red-400/90">Could not load class data.</p>
        <p className="mt-2 text-xs text-white/30">{storeError}</p>
      </main>
    );
  }

  if (!cls) {
    return (
      <main className="mx-auto max-w-md pt-12 text-center">
        <p className="text-sm text-white/60">Class not found.</p>
      </main>
    );
  }

  // Lifecycle gate: only allow check-in during the live window.
  if (cls.lifecycle === "upcoming") {
    return (
      <main className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">{cls.name}</h1>
        <p className="mt-1 text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </p>
        <div className="mt-6 rounded border border-white/10 px-4 py-4 text-sm text-white/70">
          This class hasn&apos;t started yet.
          <p className="mt-2 text-xs text-white/40">
            Check-in opens when the class goes live.
          </p>
        </div>
      </main>
    );
  }
  if (cls.lifecycle === "completed") {
    return (
      <main className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">{cls.name}</h1>
        <p className="mt-1 text-xs text-white/50">
          {cls.time} · {cls.instructor}
        </p>
        <div className="mt-6 rounded border border-white/10 px-4 py-4 text-sm text-white/70">
          This class has ended — check-in is closed.
        </div>
      </main>
    );
  }

  // Live class: show the booked roster. Exclude late_cancel entirely;
  // waitlist is already excluded by the store's mapBookingsToAttendees
  // which filters booking_status='waitlisted' before the mapper runs.
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
      await checkInMember(cls!.id, row.memberId, "client");
      setResult({ kind: "ok", name: row.name });
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : "Check-in failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">{cls.name}</h1>
      <p className="mt-1 flex items-center gap-2 text-xs text-white/50">
        <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 px-2 py-0.5 text-[11px] text-green-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
          Live
        </span>
        <span>
          {cls.time} · {cls.instructor}
        </span>
      </p>

      {result?.kind === "ok" ? (
        <div className="mt-6 rounded border border-green-400/30 bg-green-400/5 px-4 py-5 text-center">
          <p className="text-lg font-semibold text-green-300">
            ✓ You&apos;re checked in
          </p>
          <p className="mt-1 text-xs text-white/60">
            Welcome, {result.name}. Enjoy the class.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-white/70">
            Tap your name to check in.
          </p>
          {result?.kind === "error" && (
            <p className="mt-3 rounded border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-400/90">
              {result.message}
            </p>
          )}
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
                    disabled={busy || alreadyCheckedIn || noShow}
                    className={`flex w-full items-center justify-between rounded border px-4 py-3 text-left transition-colors ${
                      alreadyCheckedIn
                        ? "border-green-400/40 bg-green-400/5 text-green-300"
                        : noShow
                          ? "border-red-400/20 text-red-400/70"
                          : "border-white/15 text-white/90 hover:border-white/40 hover:bg-white/5"
                    } disabled:cursor-not-allowed`}
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
        </>
      )}
    </main>
  );
}
