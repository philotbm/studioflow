import { seedClassSlugs } from "../data";
import ClassDetail from "./class-detail";

export function generateStaticParams() {
  return seedClassSlugs.map((slug) => ({ id: slug }));
}

// Allow dynamic params beyond the static set
export const dynamicParams = true;

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassDetail id={id} />;
}
