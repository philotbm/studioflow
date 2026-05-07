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
  // key={memberSlug} forces a remount when the dynamic param changes
  // (e.g. /my/alice → /my/bob). Without it, the gate's useEffect would
  // need to reset state synchronously inside itself — which the
  // react-hooks/set-state-in-effect rule (rightly) flags as cascading
  // render. Remount-on-key gives us the same "show pending while
  // re-checking" behaviour without the lint smell.
  return (
    <MemberAccessGate key={memberSlug} slug={memberSlug}>
      {children}
    </MemberAccessGate>
  );
}
