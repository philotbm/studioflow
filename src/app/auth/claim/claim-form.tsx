"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitClaim, type ClaimActionState } from "./actions";

/**
 * v0.20.1 claim form.
 *
 * Single-page form covering all >=1-candidate cases. With a single
 * candidate the radio list collapses to a hidden input. With 2+
 * candidates the user picks one and types the digits in the same
 * submit. The server action enforces all the security checks; this
 * component just handles UI state (which row is selected, which
 * error to show, pending state).
 */

type Candidate = { id: string; slug: string; full_name: string };

const initialState: ClaimActionState = {};

export function ClaimForm({
  candidates,
  authEmail,
  next,
}: {
  candidates: Candidate[];
  authEmail: string;
  next: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitClaim,
    initialState,
  );

  // Default the radio selection to the only candidate when there's
  // exactly one, or to whatever the server action echoed back on a
  // failed submit. Otherwise leave empty so the user must pick.
  const initialSelected =
    state.selectedMemberId ??
    (candidates.length === 1 ? candidates[0].id : "");
  const [selected, setSelected] = useState(initialSelected);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />

      {candidates.length === 1 ? (
        <input type="hidden" name="memberId" value={candidates[0].id} />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs uppercase tracking-wide text-white/40">
            Pick your account
          </legend>
          {candidates.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm hover:border-white/30"
            >
              <input
                type="radio"
                name="memberId"
                value={c.id}
                checked={selected === c.id}
                onChange={() => setSelected(c.id)}
                required
              />
              <span>{c.full_name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {candidates.length === 1 && (
        <p className="rounded border border-white/15 px-3 py-2 text-sm">
          <span className="text-white/40">Account:</span>{" "}
          <span className="text-white/90">{candidates[0].full_name}</span>
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/60">
          Last 4 digits of the phone number on file with your studio
        </span>
        <input
          name="phoneDigits"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          required
          autoComplete="off"
          autoFocus
          className="rounded border border-white/15 bg-transparent px-3 py-2 text-sm tracking-widest focus:border-white/40 focus:outline-none"
          placeholder="0000"
        />
      </label>

      {state.error && (
        <p
          role="alert"
          className="rounded border border-red-400/40 px-3 py-2 text-sm text-red-400"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded border border-white/30 px-3 py-2 text-sm hover:border-white/60 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {pending ? "Confirming…" : "Confirm and continue"}
      </button>

      <p className="text-xs text-white/40">
        Signed in as {authEmail} —{" "}
        <Link
          href={`/auth/signout${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="underline hover:text-white/70"
        >
          sign me out
        </Link>
      </p>
    </form>
  );
}
