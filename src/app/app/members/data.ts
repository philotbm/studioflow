export type ActivityItem = {
  label: string;
  detail: string;
  type: "upcoming" | "attended" | "late_cancel";
};

export type Member = {
  id: string;
  name: string;
  plan: string;
  credits: number | null;
  status: "active" | "expiring" | "expired";
  activity: ActivityItem[];
};

export const members: Member[] = [
  {
    id: "emma-kelly",
    name: "Emma Kelly",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    activity: [
      { label: "Upcoming", detail: "Reformer Pilates — Thu 09:00", type: "upcoming" },
      { label: "Attended", detail: "Reformer Pilates — Mon 09:00", type: "attended" },
    ],
  },
  {
    id: "ciara-byrne",
    name: "Ciara Byrne",
    plan: "10-Class Pass",
    credits: 7,
    status: "active",
    activity: [
      { label: "Attended", detail: "Reformer Pilates — Mon 09:00", type: "attended" },
      { label: "Attended", detail: "Yoga Flow — Fri 07:00", type: "attended" },
    ],
  },
  {
    id: "declan-power",
    name: "Declan Power",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    activity: [
      { label: "Attended", detail: "Spin Express — Mon 12:30", type: "attended" },
    ],
  },
  {
    id: "saoirse-flynn",
    name: "Saoirse Flynn",
    plan: "5-Class Pass",
    credits: 1,
    status: "expiring",
    activity: [
      { label: "Upcoming", detail: "Yoga Flow — Tue 07:00", type: "upcoming" },
      { label: "Attended", detail: "Barre Tone — Wed 10:00", type: "attended" },
    ],
  },
  {
    id: "sean-brennan",
    name: "Sean Brennan",
    plan: "10-Class Pass",
    credits: 4,
    status: "active",
    activity: [
      { label: "Upcoming", detail: "HIIT Circuit — Tue 18:00", type: "upcoming" },
      { label: "Late cancel", detail: "Spin Express — Fri 12:30", type: "late_cancel" },
    ],
  },
  {
    id: "clodagh-murray",
    name: "Clodagh Murray",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    activity: [
      { label: "Upcoming", detail: "Barre Tone — Wed 10:00", type: "upcoming" },
    ],
  },
  {
    id: "conor-brady",
    name: "Conor Brady",
    plan: "5-Class Pass",
    credits: 0,
    status: "expired",
    activity: [
      { label: "Attended", detail: "Spin Express — Mon 12:30", type: "attended" },
    ],
  },
  {
    id: "aoife-nolan",
    name: "Aoife Nolan",
    plan: "Drop-in Trial",
    credits: 1,
    status: "active",
    activity: [],
  },
  {
    id: "padraig-roche",
    name: "Padraig Roche",
    plan: "10-Class Pass",
    credits: 10,
    status: "active",
    activity: [
      { label: "Upcoming", detail: "HIIT Circuit — Tue 18:00", type: "upcoming" },
    ],
  },
  {
    id: "fiona-healy",
    name: "Fiona Healy",
    plan: "5-Class Pass",
    credits: 3,
    status: "active",
    activity: [
      { label: "Attended", detail: "Yoga Flow — Tue 07:00", type: "attended" },
      { label: "Attended", detail: "Barre Tone — Mon 10:00", type: "attended" },
    ],
  },
];
