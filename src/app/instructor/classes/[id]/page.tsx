import { seedClassSlugs } from "@/app/app/classes/data";
import InstructorClass from "./instructor-class";

export function generateStaticParams() {
  return seedClassSlugs.map((slug) => ({ id: slug }));
}

export const dynamicParams = true;

export default async function InstructorClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InstructorClass id={id} />;
}
