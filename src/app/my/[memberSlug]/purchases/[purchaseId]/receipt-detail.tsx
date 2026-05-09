"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore, usePlans } from "@/lib/store";
import type { PurchaseRecord } from "@/lib/db";
import { findPlan, formatPriceEur } from "@/lib/plans";

/**
 * v0.18.2 Member receipt detail.
 *
 * Customer-safe receipt for a single purchase. v0.18.2 switched the
 * data path from the list-style getPurchases (newest-10) to a
 * direct-lookup store action getPurchaseForMember(slug, id), so a
 * receipt URL works regardless of position in the member's history.
 *
 * Ownership guard lives in the db helper: the lookup filters by
 * BOTH purchases.id AND members.id-by-slug, so a URL that matches
 * a real purchase id but belongs to a different member resolves to
 * null and renders the same "Purchase not found" page. Membership
 * is enforced server-side, not just by URL convention.
 *
 * Strict UI guardrails (unchanged from v0.18.1): never renders
 * source, external_id, or any internal vocabulary into the DOM.
 *
 * Refund + legacy presentation reuses the same conventions as the
 * v0.18.0 list: amber pill for refunded, "Older purchase record"
 * fallback for pre-v0.15.0 rows with NULL economics.
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

// Loading sentinel distinct from "lookup completed but null". Three
// states: undefined (still fetching), null (definitively not found
// for this member), PurchaseRecord (resolved).
type ReceiptState = PurchaseRecord | null | undefined;

export default function ReceiptDetail({
  memberSlug,
  purchaseId,
}: {
  memberSlug: string;
  purchaseId: string;
}) {
  const { getPurchaseForMember, members } = useStore();
  const plans = usePlans();
  const [purchase, setPurchase] = useState<ReceiptState>(undefined);

  useEffect(() => {
    let cancelled = false;
    // Reset to undefined while the next fetch is in flight. The React 19
    // react-hooks/set-state-in-effect rule prefers a parent <... key={purchaseId}>
    // remount instead, but that would require restructuring the page-level
    // wrapper — out of scope for the v0.21.0.x CI baseline. Tracked for a
    // follow-up structural pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPurchase(undefined);
    getPurchaseForMember(memberSlug, purchaseId).then((row) => {
      if (!cancelled) setPurchase(row);
    });
    return () => {
      cancelled = true;
    };
    // Refetch on members collection change so a refund fired from
    // another tab is reflected next time this page is visited /
    // re-rendered. memberSlug/purchaseId in the deps cover the
    // primary case.
  }, [getPurchaseForMember, memberSlug, purchaseId, members]);

  if (purchase === undefined) {
    return (
      <main className="mx-auto max-w-2xl">
        <BackLink memberSlug={memberSlug} />
        <p className="mt-8 text-center text-white/40">Loading receipt…</p>
      </main>
    );
  }

  if (purchase === null) {
    return (
      <main className="mx-auto max-w-2xl">
        <BackLink memberSlug={memberSlug} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          Purchase not found
        </h1>
        <p className="mt-2 text-sm text-white/50">
          We couldn&apos;t find a purchase with that reference on your
          account.
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

      {/* v0.19.0 re-engagement CTAs — only on refunded purchases. The
          member just lost an entitlement; offer immediate paths back
          (buy a new plan, browse classes if they still have credits
          on a different plan). Both buttons land on /my/{slug}; the
          Browse classes button anchors to the Browse classes section.
          Hidden on legacy refunded rows because we can't honestly
          frame "Credits removed: N" on those, and a vague "this was
          refunded" doesn't justify a re-engagement push. */}
      {isRefunded && !isLegacy && (
        <div className="mt-3 rounded border border-white/10 px-4 py-3">
          <p className="text-xs text-white/60">
            You can still book classes by purchasing a plan or using
            remaining credits.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/my/${memberSlug}`}
              className="rounded border border-white/25 px-3 py-1.5 text-xs text-white/80 hover:border-white/50 hover:text-white"
            >
              Browse plans
            </Link>
            <Link
              href={`/my/${memberSlug}#browse-classes`}
              className="rounded border border-white/25 px-3 py-1.5 text-xs text-white/80 hover:border-white/50 hover:text-white"
            >
              Browse classes
            </Link>
          </div>
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
