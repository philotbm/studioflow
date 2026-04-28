import ReceiptDetail from "./receipt-detail";

/**
 * v0.18.1 Member receipt page entry.
 *
 * Receipt URLs are unbounded (one per purchase id), so this page is
 * dynamic — no generateStaticParams. Server-side just unwraps the
 * Next.js 16 params Promise and hands off to the client component
 * which uses the existing store getPurchases action.
 */
export const dynamicParams = true;

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ memberSlug: string; purchaseId: string }>;
}) {
  const { memberSlug, purchaseId } = await params;
  return <ReceiptDetail memberSlug={memberSlug} purchaseId={purchaseId} />;
}
