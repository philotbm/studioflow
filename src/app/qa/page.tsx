"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { QA_FIXTURES, refreshQaFixtures } from "@/lib/db";

/**
 * v0.8.4.1 QA landing page.
 *
 * Purpose: a single click-through index of every deterministic QA
 * scenario StudioFlow ships, plus a one-shot refresh so the fixtures
 * are re-aligned to now() before the tester clicks through.
 *
 * Auto-refresh runs once on mount. The refresh is idempotent and can
 * be retriggered with the button — useful if the tester spent a while
 * on a scenario and wants to snap state back before re-testing.
 *
 * No production data is touched by any action on this page.
 */
export default function QaIndex() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "refreshing" }
    | { kind: "ok"; at: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const doRefresh = useCallback(async () => {
    setState({ kind: "refreshing" });
    try {
      const result = await refreshQaFixtures();
      setState({ kind: "ok", at: result.refreshedAt });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Refresh failed",
      });
    }
  }, []);

  useEffect(() => {
    doRefresh();
  }, [doRefresh]);

  const statusLine = (() => {
    switch (state.kind) {
      case "idle":
        return "Initialising fixtures…";
      case "refreshing":
        return "Refreshing fixtures…";
      case "ok": {
        const d = new Date(state.at);
        const clock =
          `${String(d.getHours()).padStart(2, "0")}:` +
          `${String(d.getMinutes()).padStart(2, "0")}:` +
          `${String(d.getSeconds()).padStart(2, "0")}`;
        return `Fixtures refreshed at ${clock}`;
      }
      case "error":
        return `Refresh failed — ${state.message}`;
    }
  })();

  const statusTone =
    state.kind === "error"
      ? "text-red-400/90"
      : state.kind === "ok"
        ? "text-green-400/80"
        : "text-white/50";

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">
        Deterministic QA matrix
      </h1>
      <p className="mt-2 text-sm text-white/60">
        Every scenario below is re-aligned to the server&apos;s current
        time when this page loads. Open one, test it, then come back
        here and click Refresh to snap state back before the next run.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={doRefresh}
          disabled={state.kind === "refreshing"}
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-40"
        >
          {state.kind === "refreshing" ? "Refreshing…" : "Refresh fixtures"}
        </button>
        <span className={`text-xs ${statusTone}`}>{statusLine}</span>
      </div>

      <ul className="mt-8 flex flex-col gap-3">
        {QA_FIXTURES.map((f) => (
          <li
            key={f.slug}
            className="rounded-lg border border-white/10 px-4 py-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-amber-300/80">
                {f.scenario}
              </span>
              <span className="text-sm font-medium">{f.label}</span>
            </div>
            <p className="mt-2 text-xs text-white/50">{f.description}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <Link
                href={`/checkin/classes/${f.slug}`}
                className="rounded border border-white/20 px-2.5 py-1 text-white/80 hover:text-white hover:border-white/40"
              >
                Client check-in →
              </Link>
              <Link
                href={`/instructor/classes/${f.slug}`}
                className="rounded border border-white/20 px-2.5 py-1 text-white/80 hover:text-white hover:border-white/40"
              >
                Instructor view →
              </Link>
              <Link
                href={`/app/classes/${f.slug}`}
                className="rounded border border-white/20 px-2.5 py-1 text-white/60 hover:text-white hover:border-white/40"
              >
                Operator audit
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-xs text-white/30">
        Fixture slugs are reserved (qa-*). The refresh RPC only touches
        those rows — every production class, member, and audit row is
        left exactly as it was.
      </p>
    </main>
  );
}
