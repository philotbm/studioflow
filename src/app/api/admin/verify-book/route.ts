import { NextResponse } from "next/server";
import { scopedQuery } from "@/lib/db";

/**
 * v0.9.2 booking enforcement trace.
 *
 * Calls sf_book_member for a given { memberSlug, classSlug } and
 * returns the server's authoritative response alongside the member's
 * credit balance before and after. Lets QA prove end-to-end that:
 *
 *   - a member with enough credits / unlimited / drop_in is allowed
 *     through and (for credits plans) loses exactly 1 credit
 *   - a member with zero credits / no entitlement / inactive account
 *     is rejected by the server with a structured reason — regardless
 *     of whether the UI pre-gated the button
 *
 * Read-only wrapper over the existing sf_book_member RPC. Does not
 * invent eligibility rules — it simply reports what the server did.
 */

type BookBody = {
  memberSlug?: string;
  classSlug?: string;
};

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
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`member not found: ${slug}`);
  return typeof data.credits_remaining === "number"
    ? data.credits_remaining
    : null;
}

async function handle(req: Request) {
  const body = (await req.json().catch(() => ({}))) as BookBody;
  const memberSlug = body.memberSlug?.trim();
  const classSlug = body.classSlug?.trim();
  if (!memberSlug || !classSlug) {
    return NextResponse.json(
      { ok: false, error: "Missing memberSlug or classSlug" },
      { status: 400 },
    );
  }
  // v0.9.3: QA-scope guard. This endpoint has real side effects
  // (sf_book_member writes a class_bookings row and consumes a credit
  // via sf_consume_credit) — it must not accidentally mutate real
  // member / class data. Restricted to qa-* fixture slugs only.
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
    // TODO(M3): pass studio_id explicitly once sf_book_member is studio-scoped.
    const bookRes = await client.rpc("sf_book_member", {
      p_class_slug: classSlug,
      p_member_slug: memberSlug,
    });
    if (bookRes.error) {
      return NextResponse.json({
        ok: false,
        stage: "rpc_error",
        error: bookRes.error.message,
        creditsBefore,
      });
    }
    const data = (bookRes.data ?? {}) as {
      status?: string;
      booking_id?: string;
      already_exists?: boolean;
      reason?: string;
      action_hint?: string;
      status_code?: string;
      entitlement_label?: string;
      credits_remaining?: number | null;
    };

    const creditsAfter = await readCredits(client, memberSlug);
    const enforced =
      data.status === "blocked" ? "blocked_by_server" : "allowed_by_server";
    const consumed =
      creditsBefore !== null && creditsAfter !== null
        ? creditsBefore - creditsAfter
        : null;

    return NextResponse.json({
      ok: true,
      memberSlug,
      classSlug,
      enforced,
      bookStatus: data.status ?? null,
      alreadyExists: data.already_exists ?? false,
      blockedReason: data.reason ?? null,
      statusCode: data.status_code ?? null,
      entitlementLabel: data.entitlement_label ?? null,
      creditsBefore,
      creditsAfter,
      consumed,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const memberSlug = url.searchParams.get("memberSlug") ?? undefined;
  const classSlug = url.searchParams.get("classSlug") ?? undefined;
  return handle(
    new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberSlug, classSlug }),
    }),
  );
}
