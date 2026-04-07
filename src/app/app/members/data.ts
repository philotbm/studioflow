export type HistoryEvent = {
  date: string;
  event: string;
  type: "attended" | "late_cancel" | "no_show" | "purchase" | "started" | "upcoming";
};

export type ClassMixEntry = {
  label: string;
  count: number;
};

export type MemberInsights = {
  totalAttended: number;
  lateCancels: number;
  noShows: number;
  cancellationRate: string;
  avgHoldBeforeCancel: string;
  preCutoffCancels: number;
  postCutoffCancels: number;
  behaviourScore: number;
  classMix: ClassMixEntry[];
};

export type Member = {
  id: string;
  name: string;
  plan: string;
  credits: number | null;
  status: "active" | "expiring" | "expired";
  insights: MemberInsights;
  history: HistoryEvent[];
};

export const members: Member[] = [
  {
    id: "emma-kelly",
    name: "Emma Kelly",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    insights: {
      totalAttended: 4,
      lateCancels: 1,
      noShows: 1,
      cancellationRate: "17%",
      avgHoldBeforeCancel: "4 hours",
      preCutoffCancels: 0,
      postCutoffCancels: 1,
      behaviourScore: 72,
      classMix: [
        { label: "Reformer Pilates", count: 2 },
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    history: [
      { date: "10 Apr", event: "Reformer Pilates — Thu 09:00", type: "upcoming" },
      { date: "7 Apr", event: "Reformer Pilates — Mon 09:00", type: "attended" },
      { date: "3 Apr", event: "Yoga Flow — Thu 07:00", type: "attended" },
      { date: "1 Apr", event: "Started Unlimited Monthly", type: "started" },
      { date: "31 Mar", event: "Barre Tone — Mon 10:00", type: "attended" },
      { date: "28 Mar", event: "Reformer Pilates — Fri 09:00", type: "late_cancel" },
      { date: "15 Mar", event: "Purchased 10-Class Pass", type: "purchase" },
      { date: "10 Mar", event: "Spin Express — Mon 12:30", type: "attended" },
      { date: "3 Mar", event: "Yoga Flow — Mon 07:00", type: "no_show" },
    ],
  },
  {
    id: "ciara-byrne",
    name: "Ciara Byrne",
    plan: "10-Class Pass",
    credits: 7,
    status: "active",
    insights: {
      totalAttended: 3,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 98,
      classMix: [
        { label: "Reformer Pilates", count: 1 },
        { label: "Yoga Flow", count: 1 },
        { label: "Spin Express", count: 1 },
      ],
    },
    history: [
      { date: "7 Apr", event: "Reformer Pilates — Mon 09:00", type: "attended" },
      { date: "4 Apr", event: "Yoga Flow — Fri 07:00", type: "attended" },
      { date: "1 Apr", event: "Spin Express — Tue 12:30", type: "attended" },
      { date: "25 Mar", event: "Purchased 10-Class Pass", type: "purchase" },
    ],
  },
  {
    id: "declan-power",
    name: "Declan Power",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    insights: {
      totalAttended: 2,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 100,
      classMix: [
        { label: "Spin Express", count: 1 },
        { label: "HIIT Circuit", count: 1 },
      ],
    },
    history: [
      { date: "7 Apr", event: "Spin Express — Mon 12:30", type: "attended" },
      { date: "3 Apr", event: "HIIT Circuit — Thu 18:00", type: "attended" },
      { date: "1 Apr", event: "Started Unlimited Monthly", type: "started" },
    ],
  },
  {
    id: "saoirse-flynn",
    name: "Saoirse Flynn",
    plan: "5-Class Pass",
    credits: 1,
    status: "expiring",
    insights: {
      totalAttended: 3,
      lateCancels: 1,
      noShows: 0,
      cancellationRate: "25%",
      avgHoldBeforeCancel: "2 hours",
      preCutoffCancels: 1,
      postCutoffCancels: 0,
      behaviourScore: 80,
      classMix: [
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
        { label: "Reformer Pilates", count: 1 },
      ],
    },
    history: [
      { date: "8 Apr", event: "Yoga Flow — Tue 07:00", type: "upcoming" },
      { date: "2 Apr", event: "Barre Tone — Wed 10:00", type: "attended" },
      { date: "28 Mar", event: "Yoga Flow — Fri 07:00", type: "attended" },
      { date: "24 Mar", event: "Reformer Pilates — Mon 09:00", type: "attended" },
      { date: "20 Mar", event: "Spin Express — Thu 12:30", type: "late_cancel" },
      { date: "15 Mar", event: "Purchased 5-Class Pass", type: "purchase" },
    ],
  },
  {
    id: "sean-brennan",
    name: "Sean Brennan",
    plan: "10-Class Pass",
    credits: 4,
    status: "active",
    insights: {
      totalAttended: 4,
      lateCancels: 1,
      noShows: 1,
      cancellationRate: "17%",
      avgHoldBeforeCancel: "6 hours",
      preCutoffCancels: 0,
      postCutoffCancels: 1,
      behaviourScore: 58,
      classMix: [
        { label: "HIIT Circuit", count: 2 },
        { label: "Spin Express", count: 2 },
      ],
    },
    history: [
      { date: "8 Apr", event: "HIIT Circuit — Tue 18:00", type: "upcoming" },
      { date: "4 Apr", event: "Spin Express — Fri 12:30", type: "late_cancel" },
      { date: "31 Mar", event: "HIIT Circuit — Mon 18:00", type: "attended" },
      { date: "27 Mar", event: "Spin Express — Thu 12:30", type: "attended" },
      { date: "24 Mar", event: "HIIT Circuit — Mon 18:00", type: "no_show" },
      { date: "20 Mar", event: "Spin Express — Thu 12:30", type: "attended" },
      { date: "17 Mar", event: "HIIT Circuit — Mon 18:00", type: "attended" },
      { date: "10 Mar", event: "Purchased 10-Class Pass", type: "purchase" },
    ],
  },
  {
    id: "clodagh-murray",
    name: "Clodagh Murray",
    plan: "Unlimited Monthly",
    credits: null,
    status: "active",
    insights: {
      totalAttended: 1,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 100,
      classMix: [
        { label: "Barre Tone", count: 1 },
      ],
    },
    history: [
      { date: "9 Apr", event: "Barre Tone — Wed 10:00", type: "upcoming" },
      { date: "2 Apr", event: "Barre Tone — Wed 10:00", type: "attended" },
      { date: "1 Apr", event: "Started Unlimited Monthly", type: "started" },
    ],
  },
  {
    id: "conor-brady",
    name: "Conor Brady",
    plan: "5-Class Pass",
    credits: 0,
    status: "expired",
    insights: {
      totalAttended: 5,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 95,
      classMix: [
        { label: "Spin Express", count: 2 },
        { label: "Yoga Flow", count: 1 },
        { label: "HIIT Circuit", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    history: [
      { date: "7 Apr", event: "Spin Express — Mon 12:30", type: "attended" },
      { date: "3 Apr", event: "Yoga Flow — Thu 07:00", type: "attended" },
      { date: "31 Mar", event: "HIIT Circuit — Mon 18:00", type: "attended" },
      { date: "27 Mar", event: "Barre Tone — Thu 10:00", type: "attended" },
      { date: "24 Mar", event: "Spin Express — Mon 12:30", type: "attended" },
      { date: "20 Mar", event: "Purchased 5-Class Pass", type: "purchase" },
    ],
  },
  {
    id: "aoife-nolan",
    name: "Aoife Nolan",
    plan: "Drop-in Trial",
    credits: 1,
    status: "active",
    insights: {
      totalAttended: 0,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 100,
      classMix: [],
    },
    history: [
      { date: "6 Apr", event: "Trial pass activated", type: "purchase" },
    ],
  },
  {
    id: "padraig-roche",
    name: "Padraig Roche",
    plan: "10-Class Pass",
    credits: 10,
    status: "active",
    insights: {
      totalAttended: 0,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 100,
      classMix: [],
    },
    history: [
      { date: "8 Apr", event: "HIIT Circuit — Tue 18:00", type: "upcoming" },
      { date: "5 Apr", event: "Purchased 10-Class Pass", type: "purchase" },
    ],
  },
  {
    id: "fiona-healy",
    name: "Fiona Healy",
    plan: "5-Class Pass",
    credits: 3,
    status: "active",
    insights: {
      totalAttended: 2,
      lateCancels: 0,
      noShows: 0,
      cancellationRate: "0%",
      avgHoldBeforeCancel: "N/A",
      preCutoffCancels: 0,
      postCutoffCancels: 0,
      behaviourScore: 100,
      classMix: [
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    history: [
      { date: "1 Apr", event: "Yoga Flow — Tue 07:00", type: "attended" },
      { date: "31 Mar", event: "Barre Tone — Mon 10:00", type: "attended" },
      { date: "25 Mar", event: "Purchased 5-Class Pass", type: "purchase" },
    ],
  },
];
