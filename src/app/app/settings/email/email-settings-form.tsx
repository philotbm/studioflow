"use client";

import { useState, useTransition } from "react";
import { setTransactionalEmailsEnabled } from "./actions";

/**
 * v0.25.0 (Sprint B) — Email-settings toggle.
 *
 * Single switch wired to setTransactionalEmailsEnabled server action.
 * Optimistic local state with revert-on-error so the toggle feels
 * responsive but stays truthful.
 */
export function EmailSettingsForm({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(checked: boolean) {
    const prev = enabled;
    setEnabled(checked);
    setError(null);
    startTransition(async () => {
      const result = await setTransactionalEmailsEnabled(checked);
      if (result.error) {
        setEnabled(prev);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 cursor-pointer"
        />
        <span className="text-sm font-medium">
          Send transactional emails to members
        </span>
      </label>
      <p className="text-xs text-white/50">
        When ON, StudioFlow sends booking confirmations, T-24h reminders,
        cancellation receipts, waitlist-promote notices, and payment
        receipts on your behalf via Resend. When OFF, no emails are sent
        — you handle this yourself.
      </p>
      {error && (
        <p
          role="alert"
          className="text-xs text-red-400"
        >
          {error}
        </p>
      )}
      {pending && (
        <p className="text-xs text-white/40">Saving…</p>
      )}
    </div>
  );
}
