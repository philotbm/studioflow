import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

/**
 * v0.9.0.1 cancellation QA trace.
 *
 * Runs a deterministic book→cancel cycle against a member and class,
 * and returns the member's credit balance at each step so the live
 * cancellation rule ("on-time restores, late does not") can be proven
 * end-to-end without a UI dance.
 *
 * Designed for QA fixture use only — qa-cancel-test is the intended
 * member (always reset to 3 credits by /api/qa/refresh). Any member
 * slug is accepted so the operator can also point it at a real
 * class_pack member if they want to.
 *
 * Pairs with:
 *   - qa-future (starts in +72h, 24h window) — cancellation cutoff is
 *     ~48h from now → any cancel hits the on-time path → +1 refund.
 *   - qa-too-early (starts in +60m, 24h window) — cancellation cutoff
 *     was ~23h ago → any cancel hits the late_cancel path → no refund.
 *
 * Usage:
 *   POST /api/admin/verify-cancellation
 *   body: { memberSlug: "qa-cancel-test", classSlug: "qa-future" }
 *
 * Returns:
 *   {
 *     ok: true,
 *     memberSlug, classSlug,
 *     creditsBefore, creditsAfterBook, creditsAfterCancel,
 *     bookStatus,      // "booked" | "waitlisted" | "blocked" | error
 *     cancelResult,    // "cancelled" | "late_cancel"
 *     refunded,        // boolean reported by sf_cancel_booking
 *     expectedRefund,  // true iff result === "cancelled" and plan consumes credits
 *     restored         // creditsAfterCancel - creditsAfterBook
 *   }
 */

async function readCredits(
  client: Awaited<ReturnType<typeof scopedQuery>>,
  slug: string,
): Promise<number | null> {
  if (!client) return null;
  const { data, error } = await client
    .from("members")
    .select("credits_remaining")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`members lookup failed: ${error.message}`);
  if (!data) throw new Error(`member not found: ${slug}`);
  return typeof data.credits_remaining === "number"
    ? data.credits_remaining
    : null;
}

async function handle(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    memberSlug?: string;
    classSlug?: string;
  };
  const memberSlug = body.memberSlug?.trim();
  const classSlug = body.classSlug?.trim();
  if (!memberSlug || !classSlug) {
    return NextResponse.json(
      { ok: false, error: "Missing memberSlug or classSlug" },
      { status: 400 },
    );
  }
  // v0.9.3: QA-scope guard. This endpoint does a full book→cancel
  // cycle with real side effects (ledger rows, booking state). Must
  // not touch real member / class data — restricted to qa-* slugs.
  if (!memberSlug.startsWith("qa-") || !classSlug.startsWith("qa-")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "qa_scope_only: this QA trace endpoint only accepts qa-* fixture slugs",
      },
      { status: 400 },
    );
  }

  const client = await scopedQuery();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase client not configured" },
      { status: 503 },
    );
  }

  try {
    const creditsBefore = await readCredits(client, memberSlug);

    // Book. sf_book_member will either succeed ("booked"/"waitlisted")
    // or block with an access payload. We surface both outcomes verbatim
    // so the trace is honest about what actually happened.
    // TODO(M3): pass studio_id explicitly once sf_book_member is studio-scoped.
    const bookRes = await client.rpc("sf_book_member", {
      p_class_slug: classSlug,
      p_member_slug: memberSlug,
    });
    if (bookRes.error) {
      return NextResponse.json({
        ok: false,
        stage: "book",
        error: bookRes.error.message,
        creditsBefore,
      });
    }
    const bookData = (bookRes.data ?? {}) as {
      status?: string;
      reason?: string;
      action_hint?: string;
    };
    if (bookData.status === "blocked") {
      return NextResponse.json({
        ok: false,
        stage: "book_blocked",
        bookStatus: "blocked",
        reason: bookData.reason,
        actionHint: bookData.action_hint,
        creditsBefore,
      });
    }
    const creditsAfterBook = await readCredits(client, memberSlug);

    // Cancel — server picks on-time vs late_cancel based on class timing
    // and cancellation_window_hours. We don't force a branch, we
    // observe which one the server chose.
    // TODO(M3): pass studio_id explicitly once sf_cancel_booking is studio-scoped.
    const cancelRes = await client.rpc("sf_cancel_booking", {
      p_class_slug: classSlug,
      p_member_slug: memberSlug,
    });
    if (cancelRes.error) {
      return NextResponse.json({
        ok: false,
        stage: "cancel",
        error: cancelRes.error.message,
        creditsBefore,
        creditsAfterBook,
      });
    }
    const cancelData = (cancelRes.data ?? {}) as {
      result?: "cancelled" | "late_cancel";
      refunded?: boolean;
      auto_promoted?: number;
    };
    const creditsAfterCancel = await readCredits(client, memberSlug);

    const bookedAt = creditsAfterBook ?? 0;
    const cancelAt = creditsAfterCancel ?? 0;
    const restored = cancelAt - bookedAt;

    return NextResponse.json({
      ok: true,
      memberSlug,
      classSlug,
      creditsBefore,
      creditsAfterBook,
      creditsAfterCancel,
      bookStatus: bookData.status ?? null,
      cancelResult: cancelData.result ?? null,
      refunded: cancelData.refunded ?? false,
      restored,
      expectedRefund: cancelData.result === "cancelled",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Accept query params too, for easy curl testing
  const url = new URL(req.url);
  const memberSlug = url.searchParams.get("memberSlug") ?? undefined;
  const classSlug = url.searchParams.get("classSlug") ?? undefined;
  const synthetic = new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberSlug, classSlug }),
  });
  return handle(synthetic);
}
