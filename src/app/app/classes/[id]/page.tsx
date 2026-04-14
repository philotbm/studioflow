import { upcomingClasses } from "../data";
import ClassDetail from "./class-detail";

export function generateStaticParams() {
  return upcomingClasses.map((cls) => ({ id: cls.id }));
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassDetail id={id} />;
}
