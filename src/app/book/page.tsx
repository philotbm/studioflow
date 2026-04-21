import { redirect } from "next/navigation";

/**
 * v0.10.1 Member Surface Correction.
 *
 * /book is NOT a public landing page. StudioFlow's member-facing
 * booking model is one-personal-URL-per-member at /book/{slug}; the
 * old all-members picker here was the wrong product shape and has
 * been removed.
 *
 * Anyone hitting /book without a slug gets redirected to the root
 * marketing page. Internal demo / QA launching happens from the
 * operator member detail (/app/members/{slug} → "View member booking
 * page →") — NOT from this route.
 */
export default function BookIndex() {
  redirect("/");
}
