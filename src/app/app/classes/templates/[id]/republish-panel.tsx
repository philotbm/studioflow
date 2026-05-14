"use client";

import { useState, useTransition } from "react";
import { republishFutureForTemplate } from "../actions";

/**
 * v0.24.0 (Sprint A) — Republish-all-future-classes UI.
 *
 * Two-step confirmation:
 *   1. Click "Compute impact" → calls republishFutureForTemplate(id, false).
 *      Returns counts (classes to rebuild + bookings on those classes).
 *   2. Read the summary, click "Confirm and republish" → calls
 *      republishFutureForTemplate(id, true) which does the in-place
 *      rebuild + materialisation fill-forward.
 *
 * The server action does the work; this component handles the
 * confirmation flow and renders the result.
 */
type Stage =
  | { kind: "idle" }
  | { kind: "preview"; rebuilt: number; bookingsAffected: number }
  | {
      kind: "done";
      rebuilt: number;
      bookingsAffected: number;
      newlyMaterialised: number;
    }
  | { kind: "error"; message: string };

export function RepublishPanel({ templateId }: { templateId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function preview() {
    startTransition(async () => {
      const res = await republishFutureForTemplate(templateId, false);
      if (!res.ok) {
        setStage({ kind: "error", message: res.error });
        return;
      }
      if (res.mode === "preview") {
        setStage({
          kind: "preview",
          rebuilt: res.counts.rebuilt,
          bookingsAffected: res.counts.bookingsAffected,
        });
      }
    });
  }

  function confirm() {
    startTransition(async () => {
      const res = await republishFutureForTemplate(templateId, true);
      if (!res.ok) {
        setStage({ kind: "error", message: res.error });
        return;
      }
      if (res.mode === "applied") {
        setStage({
          kind: "done",
          rebuilt: res.counts.rebuilt,
          bookingsAffected: res.counts.bookingsAffected,
          newlyMaterialised: res.counts.newlyMaterialised,
        });
      }
    });
  }

  function cancel() {
    setStage({ kind: "idle" });
  }

  if (stage.kind === "done") {
    return (
      <p className="mt-4 rounded border border-green-400/30 bg-green-400/[0.05] px-4 py-3 text-sm text-green-300">
        Republished. Rebuilt {stage.rebuilt} class
        {stage.rebuilt === 1 ? "" : "es"}
        {stage.bookingsAffected > 0
          ? `, ${stage.bookingsAffected} booking${stage.bookingsAffected === 1 ? "" : "s"} preserved`
          : ""}
        .
        {stage.newlyMaterialised > 0
          ? ` Materialised ${stage.newlyMaterialised} new instance${stage.newlyMaterialised === 1 ? "" : "s"} to fill the horizon.`
          : ""}
      </p>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="rounded border border-red-400/40 bg-red-400/[0.05] px-4 py-3 text-sm text-red-300">
          {stage.message}
        </p>
        <button
          type="button"
          onClick={cancel}
          className="self-start text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (stage.kind === "preview") {
    const rebuilt = stage.rebuilt;
    const bookings = stage.bookingsAffected;
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="rounded border border-amber-400/30 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-200">
          Republishing will rebuild {rebuilt} class
          {rebuilt === 1 ? "" : "es"}
          {bookings > 0
            ? ` (currently with ${bookings} booking${bookings === 1 ? "" : "s"}). Bookings will be preserved on the rebuilt classes.`
            : ". No bookings on those instances yet."}{" "}
          Continue?
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200 hover:border-amber-400/80 disabled:opacity-40"
          >
            {pending ? "Republishing…" : "Confirm and republish"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        onClick={preview}
        disabled={pending}
        className="rounded border border-amber-400/40 px-3 py-1.5 text-sm text-amber-200 hover:border-amber-400/70 disabled:opacity-40"
      >
        {pending ? "Computing…" : "Republish all future classes"}
      </button>
    </div>
  );
}
