"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  QA_FIXTURES,
  refreshQaFixtures,
  fetchQaStatus,
  type QaEnvironmentStatus,
} from "@/lib/db";

/**
 * v0.8.4.2 QA landing page.
 *
 * Two-step flow:
 *   1. On mount we probe /api/qa/status to see whether the fixture
 *      rows already exist.
 *   2. If they do not, OR the user clicks Refresh, we call
 *      /api/qa/refresh which idempotently upserts the fixtures,
 *      wipes their bookings, and inserts the documented roster for
 *      each scenario. No RPC dependency.
 *
 * The page does not imply success: the environment banner tracks the
 * actual DB state and the scenario cards disable their links while
 * the fixtures are missing or the refresh failed.
 */

type EnvState =
  | { phase: "probing" }
  | { phase: "refreshing" }
  | { phase: "ready"; status: QaEnvironmentStatus; refreshedAt?: string }
  | {
      phase: "blocked";
      status: QaEnvironmentStatus | null;
      stage: string;
      message: string;
    };

function formatClock(iso: string): string {
  const d = new Date(iso);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

export default function QaIndex() {
  const [env, setEnv] = useState<EnvState>({ phase: "probing" });

  const doRefresh = useCallback(async () => {
    setEnv({ phase: "refreshing" });
    const refreshResult = await refreshQaFixtures();
    if (!refreshResult.ok) {
      const status = await fetchQaStatus().catch(() => null);
      setEnv({
        phase: "blocked",
        status,
        stage: refreshResult.stage,
        message: refreshResult.message,
      });
      return;
    }
    const status = await fetchQaStatus();
    if (status.ready) {
      setEnv({
        phase: "ready",
        status,
        refreshedAt: refreshResult.refreshedAt,
      });
    } else {
      setEnv({
        phase: "blocked",
        status,
        stage: "post_refresh_check",
        message:
          "Refresh reported success but the fixtures are still missing. Check Supabase RLS and schema.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchQaStatus().catch(() => null);
      if (cancelled) return;
      if (status?.ready) {
        setEnv({ phase: "ready", status });
      } else {
        // Not ready — auto-refresh to self-activate.
        await doRefresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doRefresh]);

  const isReady = env.phase === "ready";
  const isBusy = env.phase === "probing" || env.phase === "refreshing";

  const banner = (() => {
    switch (env.phase) {
      case "probing":
        return (
          <div className="rounded border border-white/15 bg-white/5 px-4 py-3 text-xs text-white/60">
            Probing QA environment…
          </div>
        );
      case "refreshing":
        return (
          <div className="rounded border border-white/15 bg-white/5 px-4 py-3 text-xs text-white/60">
            Refreshing fixtures…
          </div>
        );
      case "ready":
        return (
          <div className="rounded border border-green-400/30 bg-green-400/5 px-4 py-3 text-xs text-green-300/90">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-green-400/40 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                fixtures ready
              </span>
              <span>
                {env.status.fixtureCount} QA bookings loaded across{" "}
                {QA_FIXTURES.length} scenarios
              </span>
              {env.refreshedAt && (
                <span className="text-green-400/70">
                  · refreshed {formatClock(env.refreshedAt)}
                </span>
              )}
            </div>
          </div>
        );
      case "blocked": {
        const missingClasses = env.status?.missingClasses ?? [];
        const missingMembers = env.status?.missingMembers ?? [];
        return (
          <div className="rounded border border-red-400/30 bg-red-400/5 px-4 py-3 text-xs text-red-300/90">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-red-400/40 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                refresh failed
              </span>
              <span className="font-mono text-red-400/70">stage: {env.stage}</span>
            </div>
            <p className="mt-2 text-red-200/90">{env.message}</p>
            {(missingClasses.length > 0 || missingMembers.length > 0) && (
              <p className="mt-2 text-red-200/70">
                {missingClasses.length > 0 && (
                  <>Missing classes: {missingClasses.join(", ")}. </>
                )}
                {missingMembers.length > 0 && (
                  <>Missing members: {missingMembers.join(", ")}.</>
                )}
              </p>
            )}
            <p className="mt-2 text-red-200/60">
              Scenario links are disabled until the environment is ready.
            </p>
          </div>
        );
      }
    }
  })();

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">
        Deterministic QA matrix
      </h1>
      <p className="mt-2 text-sm text-white/60">
        Scenarios snap back to the documented state relative to the
        server&apos;s current time each time the fixtures are refreshed.
      </p>

      <div className="mt-4">{banner}</div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={doRefresh}
          disabled={isBusy}
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:text-white hover:border-white/40 disabled:opacity-40"
        >
          {env.phase === "refreshing"
            ? "Refreshing…"
            : isReady
              ? "Refresh fixtures"
              : "Retry refresh"}
        </button>
        <Link
          href="/api/qa/status"
          className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
        >
          /api/qa/status
        </Link>
        <Link
          href="/api/qa/refresh"
          className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
        >
          /api/qa/refresh
        </Link>
      </div>

      <ul className="mt-8 flex flex-col gap-3">
        {QA_FIXTURES.map((f) => {
          const disabled = !isReady;
          const rowBorder = disabled
            ? "border-white/5 opacity-60"
            : "border-white/10";
          return (
            <li
              key={f.slug}
              className={`rounded-lg border px-4 py-4 ${rowBorder}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-amber-300/80">
                  {f.scenario}
                </span>
                <span className="text-sm font-medium">{f.label}</span>
                {disabled && (
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                    unavailable
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-white/50">{f.description}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {disabled ? (
                  <>
                    <span className="cursor-not-allowed rounded border border-white/10 px-2.5 py-1 text-white/30">
                      Client check-in
                    </span>
                    <span className="cursor-not-allowed rounded border border-white/10 px-2.5 py-1 text-white/30">
                      Instructor view
                    </span>
                    <span className="cursor-not-allowed rounded border border-white/10 px-2.5 py-1 text-white/30">
                      Operator audit
                    </span>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-white/30">
        Fixture slugs are reserved (qa-*). The refresh endpoint only
        touches those rows — every production class, member, and audit
        row is left exactly as it was.
      </p>
    </main>
  );
}
