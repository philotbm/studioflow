"use server";

import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { isSafeNextPath } from "@/lib/auth";

/**
 * v0.20.1 claim handshake server action.
 *
 * Two assertions hold the security boundary together:
 *
 *   - The caller must be authenticated. The ssr cookie session is
 *     read here; we never trust an `auth.uid` from the client.
 *   - The candidate row must (a) have email = auth.email, (b) be
 *     un-claimed, (c) have a phone on file. Even if a malicious
 *     client posts a forged `memberId`, the WHERE clause filters it
 *     out — the user could only ever claim a row their own email
 *     was put against by the studio.
 *
 * Lockout model: 5 wrong-digit submissions on a single row → set
 * claim_locked_until = now() + 1h, reset claim_attempts to 0 so a
 * later legitimate try after expiry isn't immediately re-locked.
 * The lock is stored on the row, not on the user, because:
 *   - The candidate is found via email match. An attacker would
 *     already need access to the user's email to be here.
 *   - Per-row tracking gives studio admins an obvious lever to
 *     unlock (UPDATE members SET claim_locked_until = NULL ...).
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_INTERVAL_MS = 60 * 60 * 1000;

export type ClaimActionState = {
  error?: string;
  /** When non-null, renders the candidate chooser pre-selected. */
  selectedMemberId?: string;
};

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

function safeEqual4(a: string, b: string): boolean {
  if (a.length !== 4 || b.length !== 4) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export async function submitClaim(
  _prev: ClaimActionState,
  formData: FormData,
): Promise<ClaimActionState> {
  const memberId = String(formData.get("memberId") ?? "");
  const phoneDigitsRaw = String(formData.get("phoneDigits") ?? "");
  const phoneDigits = digitsOnly(phoneDigitsRaw);
  const nextRaw = formData.get("next");
  const next = typeof nextRaw === "string" ? nextRaw : null;

  if (!memberId) {
    return { error: "Pick the member account that's yours." };
  }
  if (phoneDigits.length !== 4) {
    return {
      selectedMemberId: memberId,
      error: "Enter the last 4 digits of your phone number.",
    };
  }

  const supabase = await getSupabaseServerAuthClient();
  if (!supabase) {
    return { selectedMemberId: memberId, error: "Auth not configured." };
  }

  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData.user;
  if (!authUser?.email) {
    return {
      selectedMemberId: memberId,
      error: "Your session expired. Sign in again.",
    };
  }

  // The WHERE clauses are the security boundary. user_id IS NULL
  // protects against re-claiming someone else's already-linked row;
  // email = auth_email protects against claiming a stranger's row;
  // phone IS NOT NULL keeps the contract aligned with the callback.
  const { data: row } = await supabase
    .from("members")
    .select("id, slug, phone, claim_attempts, claim_locked_until")
    .eq("id", memberId)
    .eq("email", authUser.email)
    .is("user_id", null)
    .not("phone", "is", null)
    .maybeSingle();

  if (!row) {
    return {
      selectedMemberId: memberId,
      error: "That account is no longer available.",
    };
  }

  // Lockout window still active?
  if (row.claim_locked_until) {
    const lockedUntilMs = new Date(row.claim_locked_until).getTime();
    if (lockedUntilMs > Date.now()) {
      return {
        selectedMemberId: memberId,
        error:
          "Too many attempts. Contact your studio to unlock your account.",
      };
    }
  }

  const expected = digitsOnly(row.phone as string).slice(-4);
  if (expected.length !== 4) {
    // Defensive: phone column is set but doesn't yield 4 digits
    // (e.g. "+353" only). Treat as un-claimable rather than
    // matching an empty string.
    return {
      selectedMemberId: memberId,
      error: "Your studio's record can't be self-claimed. Contact them.",
    };
  }

  if (!safeEqual4(phoneDigits, expected)) {
    const newAttempts = (row.claim_attempts ?? 0) + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_INTERVAL_MS);
      await supabase
        .from("members")
        .update({
          claim_attempts: 0,
          claim_locked_until: lockUntil.toISOString(),
        })
        .eq("id", row.id);
      return {
        selectedMemberId: memberId,
        error:
          "Too many attempts. Contact your studio to unlock your account.",
      };
    }
    await supabase
      .from("members")
      .update({ claim_attempts: newAttempts })
      .eq("id", row.id);
    return {
      selectedMemberId: memberId,
      error:
        "That doesn't match. Try again or contact your studio.",
    };
  }

  // Match. Link the row and reset the attempt counter. The
  // additional user_id IS NULL filter guards against a TOCTOU race
  // with a parallel claim hitting the same row.
  const { data: claimed, error: claimError } = await supabase
    .from("members")
    .update({
      user_id: authUser.id,
      claim_attempts: 0,
      claim_locked_until: null,
    })
    .eq("id", row.id)
    .is("user_id", null)
    .select("slug")
    .single();

  if (claimError || !claimed) {
    return {
      selectedMemberId: memberId,
      error: "Couldn't link your account. Try again.",
    };
  }

  if (isSafeNextPath(next)) {
    redirect(next);
  }
  redirect(`/my/${claimed.slug}`);
}
