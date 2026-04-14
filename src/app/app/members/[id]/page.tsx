import { seedMembers } from "../data";
import MemberDetail from "./member-detail";

export function generateStaticParams() {
  return seedMembers.map((m) => ({ id: m.id }));
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemberDetail id={id} />;
}
