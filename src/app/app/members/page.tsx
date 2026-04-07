type Member = {
  name: string;
  plan: string;
  credits: number | null;
  status: "active" | "expiring" | "expired";
};

const members: Member[] = [
  { name: "Emma Kelly", plan: "Unlimited Monthly", credits: null, status: "active" },
  { name: "Ciara Byrne", plan: "10-Class Pass", credits: 7, status: "active" },
  { name: "Declan Power", plan: "Unlimited Monthly", credits: null, status: "active" },
  { name: "Saoirse Flynn", plan: "5-Class Pass", credits: 1, status: "expiring" },
  { name: "Sean Brennan", plan: "10-Class Pass", credits: 4, status: "active" },
  { name: "Clodagh Murray", plan: "Unlimited Monthly", credits: null, status: "active" },
  { name: "Conor Brady", plan: "5-Class Pass", credits: 0, status: "expired" },
  { name: "Aoife Nolan", plan: "Drop-in Trial", credits: 1, status: "active" },
  { name: "Padraig Roche", plan: "10-Class Pass", credits: 10, status: "active" },
  { name: "Fiona Healy", plan: "5-Class Pass", credits: 3, status: "active" },
];

function creditDisplay(member: Member) {
  if (member.credits === null) return { text: "Unlimited", style: "text-green-400" };
  if (member.credits === 0) return { text: "No credits", style: "text-red-400" };
  if (member.credits === 1) return { text: "1 credit left", style: "text-amber-400" };
  return { text: `${member.credits} credits`, style: "text-white/50" };
}

export default function MembersPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add member
        </button>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {members.map((m, i) => {
          const credit = creditDisplay(m);
          return (
            <li
              key={i}
              className="flex flex-col gap-1 rounded-lg border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-xs text-white/50">{m.plan}</span>
              </div>
              <span className={`mt-1 text-xs sm:mt-0 ${credit.style}`}>
                {credit.text}
              </span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
