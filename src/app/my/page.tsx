import { redirect } from "next/navigation";

/**
 * v0.11.0 Member Home root.
 *
 * /my has no slugless entry point in this phase — a member always
 * reaches their home at /my/{memberSlug}. Bare /my redirects to the
 * marketing root for now. Once auth lands, /my will become the
 * auto-resolved home for the signed-in member.
 */
export default function MyIndex() {
  redirect("/");
}
