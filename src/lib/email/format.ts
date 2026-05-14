/**
 * Small formatting helpers used across email templates. Kept here
 * rather than inlined so the templates stay declarative and the
 * formatting logic has one place to change.
 */

/** "Mon 15 Aug · 18:00" style summary for a class start time. */
export function formatClassWhen(isoStartsAt: string): string {
  const d = new Date(isoStartsAt);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** Format integer cents as "€12.50" (Euro pre-pilot — Ireland). */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const euros = (cents / 100).toFixed(2);
  return `€${euros}`;
}
