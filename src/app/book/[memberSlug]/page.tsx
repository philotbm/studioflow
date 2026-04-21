import { redirect } from "next/navigation";

/**
 * v0.11.0 backward-compat redirect.
 *
 * The member-facing home moved from /book/{slug} to /my/{slug}. Any
 * existing link to /book/{slug} (e.g. a QR code, email, or shared URL
 * from the brief /book/{slug} window in v0.10.x) redirects to the new
 * canonical URL. This wrapper will be removed once the old URL surface
 * is definitely unused in the wild.
 */
export default async function BookMemberRedirect({
  params,
}: {
  params: Promise<{ memberSlug: string }>;
}) {
  const { memberSlug } = await params;
  redirect(`/my/${memberSlug}`);
}
