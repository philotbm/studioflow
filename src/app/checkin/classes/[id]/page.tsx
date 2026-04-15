import { seedClassSlugs } from "@/app/app/classes/data";
import CheckInClass from "./checkin-class";

export function generateStaticParams() {
  return seedClassSlugs.map((slug) => ({ id: slug }));
}

export const dynamicParams = true;

export default async function CheckInClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CheckInClass id={id} />;
}
