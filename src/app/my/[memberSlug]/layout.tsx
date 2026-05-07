import { MemberAccessGate } from "./member-access-gate";

/**
 * v0.20.0 — auth gate for every page under /my/{slug}/.
 *
 * Server layout that awaits the route params (Next 16 hands them as
 * a Promise) and hands the slug to the client-side gate. The gate
 * confirms the authenticated user owns the slug; on miss it either
 * redirects to /login?next=... or renders an inline 403.
 */
export default async function MemberSlugLayout({
  params,
  children,
}: {
  params: Promise<{ memberSlug: string }>;
  children: React.ReactNode;
}) {
  const { memberSlug } = await params;
  return <MemberAccessGate slug={memberSlug}>{children}</MemberAccessGate>;
}
