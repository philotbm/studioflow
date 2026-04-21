import MemberHome from "./member-home";
import { seedMemberSlugs } from "@/app/app/members/data";

/**
 * v0.11.0 Member Home entry.
 *
 * SSG-prerendered for every seeded member slug. Members outside the
 * seed list fall through to client-side rendering — the store fetches
 * them from Supabase on mount and renders the same MemberHome below.
 */
export function generateStaticParams() {
  return seedMemberSlugs.map((slug) => ({ memberSlug: slug }));
}

export default async function MemberHomePage({
  params,
}: {
  params: Promise<{ memberSlug: string }>;
}) {
  const { memberSlug } = await params;
  return <MemberHome memberSlug={memberSlug} />;
}
