"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore, usePlans } from "@/lib/store";
import type { PurchaseRecord } from "@/lib/db";
import { findPlan, formatPriceEur } from "@/lib/plans";

/**
 * v0.18.1 Member receipt detail.
 *
 * Customer-safe receipt for a single purchase. Reads via the same
 * store action (getPurchases) the v0.18.0 list uses, so the two
 * surfaces never drift. Strict guardrails: never renders source,
 * external_id, or any internal vocabulary into the DOM.
 *
 * Refund + legacy presentation reuses the same conventions as the
 * v0.18.0 list: amber pill for refunded, "Older purchase record"
 * fallback for pre-v0.15.0 rows with NULL economics.
 *
 * Uses the same default getPurchases limit (10) as the list page
 * for consistency. Receipts for purchases older than the 10 most
 * recent will resolve to "Purchase not found" — minor edge case for
 * direct-link users; the in-product path always lands inside the
 * list. Documented in the release notes.
 */

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  refunded: "Refunded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONES: Record<string, string> = {
  completed: "border-green-400/30 text-green-400",
  refunded: "border-amber-400/30 text-amber-300",
  failed: "border-red-400/30 text-red-400",
  cancelled: "border-white/20 text-white/50",
};

/** First 8 chars of the UUID. Long enough to be a useful reference,
 *  short enough to read at a glance. */
function shortenReference(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

function absoluteDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function absoluteDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function BackLink({ memberSlug }: { memberSlug: string }) {
  return (
    <Link
      href={`/my/${memberSlug}`}
      className="text-xs text-white/40 hover:text-white/70"
    >
      &larr; Back to account
    </Link>
  );
}

export default function ReceiptDetail({
  memberSlug,
  purchaseId,
}: {
  memberSlug: string;
  purchaseId: string;
}) {
  const { getPurchases, members } = useStore();
  const plans = usePlans();
  const [entries, setEntries] = useState<PurchaseRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchases(memberSlug).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
    // Refetch on members collection change so a refund fired from
    // another tab is reflected next time this page is visited /
    // re-rendered.
  }, [getPurchases, memberSlug, members]);

  if (entries === null) {
    return (
      <main className="mx-auto max-w-2xl">
        <BackLink memberSlug={memberSlug} />
        <p className="mt-8 text-center text-white/40">Loading receipt…</p>
      </main>
    );
  }

  const purchase = entries.find((p) => p.id === purchaseId);
  if (!purchase) {
    return (
      <main className="mx-auto max-w-2xl">
        <BackLink memberSlug={memberSlug} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Purchase not found
        </h1>
        <p className="mt-2 text-sm text-white/50">
          We couldn&apos;t find a purchase with that reference. It may
          be older than the most recent ten on your account.
        </p>
      </main>
    );
  }

  const plan = findPlan(purchase.planId, plans);
  const planName = plan?.name ?? "Plan";
  const statusKey = purchase.status;
  const statusLabel = STATUS_LABELS[statusKey] ?? "Completed";
  const statusTone =
    STATUS_TONES[statusKey] ?? "border-white/20 text-white/50";

  const isLegacy =
    purchase.priceCentsPaid === null || purchase.creditsGranted === null;
  const isUnlimited =
    plan?.type === "unlimited" ||
    (plan === undefined && !isLegacy && purchase.creditsGranted === null);
  const isRefunded = purchase.status === "refunded";

  const entitlementText = isUnlimited
    ? "Unlimited access"
    : purchase.creditsGranted === null
      ? null
      : purchase.creditsGranted === 1
        ? "1 credit added"
        : `${purchase.creditsGranted} credits added`;

  const priceText =
    purchase.priceCentsPaid === null
      ? null
      : formatPriceEur(purchase.priceCentsPaid);

  const referenceText = shortenReference(purchase.id);

  return (
    <main className="mx-auto max-w-2xl">
      <BackLink memberSlug={memberSlug} />

      {/* Header */}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{planName}</h1>
          <p className="text-xs text-white/50">
            {absoluteDate(purchase.createdAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Refund banner — only for refunded purchases. Member-safe
          copy; no source, no operator vocabulary. */}
      {isRefunded && !isLegacy && (
        <div className="mt-6 rounded border border-amber-400/30 bg-amber-400/5 px-4 py-3">
          <p className="text-sm font-medium text-amber-300">
            This purchase was refunded
          </p>
          {purchase.creditsGranted !== null && (
            <p className="mt-1 text-xs text-amber-200/80">
              {purchase.creditsGranted === 1
                ? "Credits removed: 1"
                : `Credits removed: ${purchase.creditsGranted}`}
            </p>
          )}
        </div>
      )}

      {/* Receipt body */}
      <section className="mt-6 rounded border border-white/10 px-4 py-4">
        <h2 className="text-xs uppercase tracking-wide text-white/40">
          Receipt details
        </h2>
        {isLegacy ? (
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-sm text-white/70">Older purchase record</p>
            <p className="text-xs text-white/40">
              Full receipt details unavailable
            </p>
          </div>
        ) : (
          <dl className="mt-3 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-white/40">Amount paid</dt>
              <dd className="text-sm font-medium">
                {priceText ?? "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-white/40">
                {isUnlimited ? "Access" : "Credits"}
              </dt>
              <dd className="text-sm">{entitlementText ?? "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-white/40">Status</dt>
              <dd className="text-sm">{statusLabel}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-white/40">Purchased on</dt>
              <dd className="text-sm">
                {absoluteDateTime(purchase.createdAt)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-white/40">Reference</dt>
              <dd className="font-mono text-xs text-white/60">
                {referenceText}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <p className="mt-6 text-[11px] text-white/30">
        Need help with this purchase? Contact the studio.
      </p>
    </main>
  );
}
