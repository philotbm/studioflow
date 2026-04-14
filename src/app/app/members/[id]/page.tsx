import { seedMemberSlugs } from "../data";
import MemberDetail from "./member-detail";

export function generateStaticParams() {
  return seedMemberSlugs.map((slug) => ({ id: slug }));
}

export const dynamicParams = true;

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemberDetail id={id} />;
}
