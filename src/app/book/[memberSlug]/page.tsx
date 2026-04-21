import MemberHome from "./member-home";
import { seedMemberSlugs } from "@/app/app/members/data";

/**
 * v0.10.0 member-facing booking surface.
 *
 * Uses the same SSG prerender pattern as /app/members/[id]. Members
 * outside the seed list will still render client-side — the store
 * fetches them from Supabase on mount.
 */
export function generateStaticParams() {
  return seedMemberSlugs.map((slug) => ({ memberSlug: slug }));
}

export default async function MemberBookPage({
  params,
}: {
  params: Promise<{ memberSlug: string }>;
}) {
  const { memberSlug } = await params;
  return <MemberHome memberSlug={memberSlug} />;
}
