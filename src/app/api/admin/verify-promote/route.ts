import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * v0.9.2 waitlist promotion enforcement trace.
 *
 * Calls sf_promote_member for a given { memberSlug, classSlug } and
 * reports what the server did. sf_promote_member runs the same
 * sf_check_eligibility gate that sf_book_member uses, so an
 * ineligible waitlisted member is rejected with a structured reason
 * rather than quietly consuming capacity.
 *
 * Pairs with /api/admin/verify-book and /api/admin/verify-cancellation
 * so every economic entry point (book, cancel, promote) has a QA
 * surface that returns the server's authoritative outcome + the
 * member's credit balance before and after.
 *
 * NOTE: sf_promote_member requires the member to currently be
 * waitlisted into the class. If the member isn't on the waitlist the
 * RPC returns { error: "No waitlisted booking found" }, surfaced
 * here verbatim.
 */

type PromoteBody = {
  memberSlug?: string;
  classSlug?: string;
};

async function readCredits(
  client: ReturnType<typeof getSupabaseClient>,
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
  const body = (await req.json().catch(() => ({}))) as PromoteBody;
  const memberSlug = body.memberSlug?.trim();
  const classSlug = body.classSlug?.trim();
  if (!memberSlug || !classSlug) {
    return NextResponse.json(
      { ok: false, error: "Missing memberSlug or classSlug" },
      { status: 400 },
    );
  }

  const client = getSupabaseClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Supabase client not configured" },
      { status: 503 },
    );
  }

  try {
    const creditsBefore = await readCredits(client, memberSlug);
    const promRes = await client.rpc("sf_promote_member", {
      p_class_slug: classSlug,
      p_member_slug: memberSlug,
    });
    if (promRes.error) {
      return NextResponse.json({
        ok: false,
        stage: "rpc_error",
        error: promRes.error.message,
        creditsBefore,
      });
    }
    const data = (promRes.data ?? {}) as {
      result?: string;
      auto_promoted?: number;
      error?: string;
    };

    const creditsAfter = await readCredits(client, memberSlug);
    const consumed =
      creditsBefore !== null && creditsAfter !== null
        ? creditsBefore - creditsAfter
        : null;

    // sf_promote_member returns { error: "..." } inside the jsonb
    // when it rejects on eligibility / no waitlist row. Treat that as
    // a structured server-side rejection for the trace.
    if (data.error) {
      return NextResponse.json({
        ok: true,
        memberSlug,
        classSlug,
        enforced: "blocked_by_server",
        promoteResult: null,
        blockedReason: data.error,
        creditsBefore,
        creditsAfter,
        consumed,
      });
    }

    return NextResponse.json({
      ok: true,
      memberSlug,
      classSlug,
      enforced: "allowed_by_server",
      promoteResult: data.result ?? null,
      autoPromoted: data.auto_promoted ?? 0,
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
