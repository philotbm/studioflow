import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerAuthClient } from "@/lib/supabase";
import { isSafeNextPath } from "@/lib/auth";
import { ClaimForm } from "./claim-form";

/**
 * v0.20.1 self-claim page.
 *
 * Reachable by anyone with a valid session whose email matches at
 * least one un-claimed members row that has a phone on file. The
 * /auth/callback decision tree routes here; direct hits (e.g. a
 * user who bookmarked the URL) work too.
 *
 * Edge cases:
 *
 *   - No session at all → bounce to /login. The user shouldn't be
 *     here if the cookie session is missing.
 *   - Session but already linked → straight to /my/{slug} (or next).
 *     Re-claim is not a thing post-link.
 *   - Session, no candidates → render the friendly "ask your studio"
 *     panel with a sign-out link.
 *   - 1 or 2+ candidates → hand off to ClaimForm.
 */

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = isSafeNextPath(rawNext ?? null) ? (rawNext as string) : null;

  const supabase = await getSupabaseServerAuthClient();
  if (!supabase) {
    redirect("/login?error=auth&reason=not_configured");
  }

  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData.user;
  if (!authUser?.email) {
    const loginUrl = next
      ? `/login?next=${encodeURIComponent(next)}`
      : "/login";
    redirect(loginUrl);
  }

  // Already linked? Don't show the claim UI.
  const { data: linked } = await supabase
    .from("members")
    .select("slug")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (linked?.slug) {
    redirect(next ?? `/my/${linked.slug}`);
  }

  const { data: candidates } = await supabase
    .from("members")
    .select("id, slug, full_name")
    .eq("email", authUser.email)
    .is("user_id", null)
    .not("phone", "is", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12 text-white">
      <Link
        href="/"
        className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
      >
        StudioFlow
      </Link>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">
        Confirm your account
      </h1>

      {!candidates || candidates.length === 0 ? (
        <>
          <p className="mt-3 text-sm text-white/70">
            We couldn&apos;t find an account for {authUser.email} that&apos;s
            ready to claim.
          </p>
          <p className="mt-2 text-sm text-white/60">
            Ask your studio to add you (or to add a phone number to your
            record), then sign in again.
          </p>
          <Link
            href={`/auth/signout${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="mt-6 inline-block rounded border border-white/25 px-3 py-2 text-sm hover:border-white/50"
          >
            Sign me out
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-white/70">
            We found {candidates.length === 1 ? "an account" : "accounts"}{" "}
            for {authUser.email}. If{" "}
            {candidates.length === 1 ? "this is" : "one of these is"} you,
            confirm by entering the last 4 digits of the phone number on
            file with your studio.
          </p>
          <ClaimForm
            candidates={candidates}
            authEmail={authUser.email}
            next={next}
          />
        </>
      )}
    </main>
  );
}
