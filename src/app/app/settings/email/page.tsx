import Link from "next/link";
import { scopedQuery } from "@/lib/db";
import { EmailSettingsForm } from "./email-settings-form";

/**
 * v0.25.0 (Sprint B) — Email settings.
 *
 * Single toggle: per-studio blanket opt-out for transactional emails.
 * Server component reads the current state; client component renders
 * the toggle and calls the server action on change.
 */
export default async function EmailSettingsPage() {
  const client = await scopedQuery();
  if (!client) {
    return (
      <main className="mx-auto max-w-2xl pt-12 text-center">
        <p className="text-red-400 text-sm">
          Database client not configured.
        </p>
      </main>
    );
  }

  // scopedQuery doesn't auto-scope `studios` (not in TENANT_SCOPED_TABLES);
  // RLS policy studios_tenant_isolation already limits the SELECT to the
  // operator's own row.
  const { data: studios } = await client
    .from("studios")
    .select("id, name, transactional_emails_enabled")
    .limit(1);
  const studio = studios?.[0];

  const enabled = studio
    ? Boolean(studio.transactional_emails_enabled)
    : true;

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app"
        className="text-xs uppercase tracking-wide text-white/40 hover:text-white/80"
      >
        ← App
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Email settings</h1>
      <p className="mt-1 text-sm text-white/50">
        Transactional email — booking confirmations, reminders, and
        receipts — sent automatically to members on your studio&apos;s behalf.
      </p>

      <section className="mt-8 rounded-lg border border-white/10 p-5">
        <EmailSettingsForm initialEnabled={enabled} />
      </section>

      <p className="mt-6 text-xs text-white/40">
        Pre-pilot: a single blanket switch. Per-template granularity and
        per-member unsubscribe arrive with the v0.31.0 GDPR work.
      </p>
    </main>
  );
}
