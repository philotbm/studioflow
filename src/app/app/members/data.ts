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
  behaviourLabel: "Strong" | "Mixed" | "Needs attention";
  classMix: ClassMixEntry[];
};

export type CreditUsageEntry = {
  className: string;
  date: string;
};

export type PurchaseStatus = "Active" | "Previous" | "Consumed" | "Expired";

export type CreditPackPurchase = {
  type: "credit_pack";
  product: string;
  purchaseDate: string;
  totalCredits: number;
  creditsUsed: number;
  creditsRemaining: number;
  lastUsedDate: string | null;
  purchaseStatus: PurchaseStatus;
  usageLog: CreditUsageEntry[];
};

export type UnlimitedPurchase = {
  type: "unlimited";
  product: string;
  startDate: string;
  classesAttendedSinceStart: number;
  purchaseStatus: PurchaseStatus;
};

export type SimplePurchase = {
  type: "simple";
  product: string;
  purchaseDate: string;
  purchaseStatus: PurchaseStatus;
};

export type PurchaseEntry = CreditPackPurchase | UnlimitedPurchase | SimplePurchase;

export type PurchaseInsights = {
  activePlan: PurchaseEntry;
  previousPurchases: PurchaseEntry[];
  buyerPattern: string;
};

export type Member = {
  id: string;
  name: string;
  plan: string;
  credits: number | null;
  status: "active" | "expiring" | "expired";
  insights: MemberInsights;
  purchaseInsights: PurchaseInsights;
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
      behaviourLabel: "Mixed",
      classMix: [
        { label: "Reformer Pilates", count: 2 },
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "unlimited",
        product: "Unlimited Monthly",
        startDate: "1 Apr",
        classesAttendedSinceStart: 2,
        purchaseStatus: "Active",
      },
      previousPurchases: [
        {
          type: "credit_pack",
          product: "10-Class Pass",
          purchaseDate: "15 Mar",
          totalCredits: 10,
          creditsUsed: 10,
          creditsRemaining: 0,
          lastUsedDate: "31 Mar",
          purchaseStatus: "Consumed",
          usageLog: [
            { className: "Spin Express", date: "10 Mar" },
            { className: "Barre Tone", date: "31 Mar" },
          ],
        },
      ],
      buyerPattern: "Moved from packs to unlimited",
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
      behaviourLabel: "Strong",
      classMix: [
        { label: "Reformer Pilates", count: 1 },
        { label: "Yoga Flow", count: 1 },
        { label: "Spin Express", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "10-Class Pass",
        purchaseDate: "25 Mar",
        totalCredits: 10,
        creditsUsed: 3,
        creditsRemaining: 7,
        lastUsedDate: "7 Apr",
        purchaseStatus: "Active",
        usageLog: [
          { className: "Spin Express", date: "1 Apr" },
          { className: "Yoga Flow", date: "4 Apr" },
          { className: "Reformer Pilates", date: "7 Apr" },
        ],
      },
      previousPurchases: [],
      buyerPattern: "First-time class pack buyer",
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
      behaviourLabel: "Strong",
      classMix: [
        { label: "Spin Express", count: 1 },
        { label: "HIIT Circuit", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "unlimited",
        product: "Unlimited Monthly",
        startDate: "1 Apr",
        classesAttendedSinceStart: 2,
        purchaseStatus: "Active",
      },
      previousPurchases: [],
      buyerPattern: "New unlimited member",
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
      behaviourLabel: "Mixed",
      classMix: [
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
        { label: "Reformer Pilates", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "5-Class Pass",
        purchaseDate: "15 Mar",
        totalCredits: 5,
        creditsUsed: 4,
        creditsRemaining: 1,
        lastUsedDate: "2 Apr",
        purchaseStatus: "Active",
        usageLog: [
          { className: "Reformer Pilates", date: "24 Mar" },
          { className: "Yoga Flow", date: "28 Mar" },
          { className: "Barre Tone", date: "2 Apr" },
        ],
      },
      previousPurchases: [],
      buyerPattern: "First-time class pack buyer",
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
      behaviourLabel: "Needs attention",
      classMix: [
        { label: "HIIT Circuit", count: 2 },
        { label: "Spin Express", count: 2 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "10-Class Pass",
        purchaseDate: "10 Mar",
        totalCredits: 10,
        creditsUsed: 6,
        creditsRemaining: 4,
        lastUsedDate: "31 Mar",
        purchaseStatus: "Active",
        usageLog: [
          { className: "HIIT Circuit", date: "17 Mar" },
          { className: "Spin Express", date: "20 Mar" },
          { className: "Spin Express", date: "27 Mar" },
          { className: "HIIT Circuit", date: "31 Mar" },
        ],
      },
      previousPurchases: [],
      buyerPattern: "Usually buys class packs",
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
      behaviourLabel: "Strong",
      classMix: [
        { label: "Barre Tone", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "unlimited",
        product: "Unlimited Monthly",
        startDate: "1 Apr",
        classesAttendedSinceStart: 1,
        purchaseStatus: "Active",
      },
      previousPurchases: [],
      buyerPattern: "New unlimited member",
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
      behaviourLabel: "Strong",
      classMix: [
        { label: "Spin Express", count: 2 },
        { label: "Yoga Flow", count: 1 },
        { label: "HIIT Circuit", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "5-Class Pass",
        purchaseDate: "20 Mar",
        totalCredits: 5,
        creditsUsed: 5,
        creditsRemaining: 0,
        lastUsedDate: "7 Apr",
        purchaseStatus: "Consumed",
        usageLog: [
          { className: "Spin Express", date: "24 Mar" },
          { className: "Barre Tone", date: "27 Mar" },
          { className: "HIIT Circuit", date: "31 Mar" },
          { className: "Yoga Flow", date: "3 Apr" },
          { className: "Spin Express", date: "7 Apr" },
        ],
      },
      previousPurchases: [],
      buyerPattern: "Reliable pack user — may repurchase",
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
      behaviourLabel: "Strong",
      classMix: [],
    },
    purchaseInsights: {
      activePlan: {
        type: "simple",
        product: "Drop-in Trial",
        purchaseDate: "6 Apr",
        purchaseStatus: "Active",
      },
      previousPurchases: [],
      buyerPattern: "Occasional drop-in buyer",
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
      behaviourLabel: "Strong",
      classMix: [],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "10-Class Pass",
        purchaseDate: "5 Apr",
        totalCredits: 10,
        creditsUsed: 0,
        creditsRemaining: 10,
        lastUsedDate: null,
        purchaseStatus: "Active",
        usageLog: [],
      },
      previousPurchases: [],
      buyerPattern: "New class pack buyer",
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
      behaviourLabel: "Strong",
      classMix: [
        { label: "Yoga Flow", count: 1 },
        { label: "Barre Tone", count: 1 },
      ],
    },
    purchaseInsights: {
      activePlan: {
        type: "credit_pack",
        product: "5-Class Pass",
        purchaseDate: "25 Mar",
        totalCredits: 5,
        creditsUsed: 2,
        creditsRemaining: 3,
        lastUsedDate: "1 Apr",
        purchaseStatus: "Active",
        usageLog: [
          { className: "Barre Tone", date: "31 Mar" },
          { className: "Yoga Flow", date: "1 Apr" },
        ],
      },
      previousPurchases: [],
      buyerPattern: "First-time class pack buyer",
    },
    history: [
      { date: "1 Apr", event: "Yoga Flow — Tue 07:00", type: "attended" },
      { date: "31 Mar", event: "Barre Tone — Mon 10:00", type: "attended" },
      { date: "25 Mar", event: "Purchased 5-Class Pass", type: "purchase" },
    ],
  },
];
