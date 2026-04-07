import Link from "next/link";
import { notFound } from "next/navigation";
import { members, type Member } from "../data";

function creditDisplay(member: Member) {
  if (member.credits === null) return { text: "Unlimited", style: "text-green-400" };
  if (member.credits === 0) return { text: "No credits", style: "text-red-400" };
  if (member.credits === 1) return { text: "1 credit left", style: "text-amber-400" };
  return { text: `${member.credits} credits`, style: "text-white/50" };
}

const activityColor: Record<string, string> = {
  upcoming: "text-white/60",
  attended: "text-green-400",
  late_cancel: "text-red-400",
};

export function generateStaticParams() {
  return members.map((m) => ({ id: m.id }));
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = members.find((m) => m.id === id);

  if (!member) {
    notFound();
  }

  const credit = creditDisplay(member);

  return (
    <main className="mx-auto max-w-2xl">
      <Link
        href="/app/members"
        className="text-xs text-white/40 hover:text-white/70"
      >
        &larr; Back to members
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/50">
          <span>{member.plan}</span>
          <span className={credit.style}>{credit.text}</span>
        </div>
      </div>

      {member.activity.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-white/70">Recent activity</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {member.activity.map((a, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded border border-white/10 px-4 py-2"
              >
                <span className="text-sm text-white/80">{a.detail}</span>
                <span className={`text-xs ${activityColor[a.type]}`}>
                  {a.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
