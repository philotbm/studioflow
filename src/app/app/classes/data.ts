export type Attendee = {
  name: string;
  memberId: string;
  status:
    | "booked"
    | "attended"
    | "late_cancel"
    | "no_show"
    | "checked_in"
    | "not_checked_in";
};

export type Lifecycle = "upcoming" | "live" | "completed";

export type WaitlistEntry = {
  name: string;
  memberId: string;
  position: number;
};

export type StudioClass = {
  id: string;
  name: string;
  time: string;
  instructor: string;
  capacity: number;
  lifecycle: Lifecycle;
  cancellationWindowClosed?: boolean;
  attendees: Attendee[];
  waitlist?: WaitlistEntry[];
};

export const upcomingClasses: StudioClass[] = [
  // --- Completed ---
  {
    id: "reformer-mon-9",
    name: "Reformer Pilates",
    time: "Mon 09:00",
    instructor: "Sarah",
    capacity: 12,
    lifecycle: "completed",
    attendees: [
      { name: "Emma Kelly", memberId: "emma-kelly", status: "attended" },
      { name: "Ciara Byrne", memberId: "ciara-byrne", status: "attended" },
      { name: "Niamh Walsh", memberId: "niamh-walsh", status: "attended" },
      { name: "Orla Duffy", memberId: "orla-duffy", status: "attended" },
      { name: "Sinead Murphy", memberId: "sinead-murphy", status: "no_show" },
      { name: "Roisin Daly", memberId: "roisin-daly", status: "late_cancel" },
      { name: "Aisling Nolan", memberId: "aisling-nolan", status: "attended" },
      { name: "Maeve Ryan", memberId: "maeve-ryan", status: "attended" },
    ],
  },
  // --- Live ---
  {
    id: "spin-mon-1230",
    name: "Spin Express",
    time: "Mon 12:30",
    instructor: "James",
    capacity: 6,
    lifecycle: "live",
    attendees: [
      { name: "Declan Power", memberId: "declan-power", status: "checked_in" },
      { name: "Fiona Healy", memberId: "fiona-healy", status: "not_checked_in" },
      { name: "Conor Brady", memberId: "conor-brady", status: "checked_in" },
      { name: "Laura Keane", memberId: "laura-keane", status: "not_checked_in" },
    ],
  },
  // --- Completed ---
  {
    id: "yoga-tue-7",
    name: "Yoga Flow",
    time: "Tue 07:00",
    instructor: "Aoife",
    capacity: 6,
    lifecycle: "completed",
    attendees: [
      { name: "Saoirse Flynn", memberId: "saoirse-flynn", status: "attended" },
      { name: "Grainne Doyle", memberId: "grainne-doyle", status: "attended" },
      { name: "Eimear Cahill", memberId: "eimear-cahill", status: "no_show" },
    ],
  },
  // --- Upcoming (cancellation window closed — late cancel applies) ---
  {
    id: "hiit-tue-1800",
    name: "HIIT Circuit",
    time: "Tue 18:00",
    instructor: "Mark",
    capacity: 5,
    lifecycle: "upcoming",
    cancellationWindowClosed: true,
    attendees: [
      { name: "Sean Brennan", memberId: "sean-brennan", status: "booked" },
      { name: "Padraig Roche", memberId: "padraig-roche", status: "booked" },
      { name: "Cian O'Neill", memberId: "cian-oneill", status: "booked" },
      { name: "Dara Fitzpatrick", memberId: "dara-fitzpatrick", status: "late_cancel" },
      { name: "Eoin Gallagher", memberId: "eoin-gallagher", status: "booked" },
    ],
    waitlist: [
      { name: "Tara Lynch", memberId: "tara-lynch", position: 1 },
      { name: "Ronan Kavanagh", memberId: "ronan-kavanagh", position: 2 },
      { name: "Ailbhe Connolly", memberId: "ailbhe-connolly", position: 3 },
    ],
  },
  // --- Upcoming (cancellation window still open) ---
  {
    id: "barre-wed-10",
    name: "Barre Tone",
    time: "Wed 10:00",
    instructor: "Sarah",
    capacity: 8,
    lifecycle: "upcoming",
    cancellationWindowClosed: false,
    attendees: [
      { name: "Clodagh Murray", memberId: "clodagh-murray", status: "booked" },
      { name: "Aoibhinn Smyth", memberId: "aoibhinn-smyth", status: "booked" },
      { name: "Deirdre Whelan", memberId: "deirdre-whelan", status: "booked" },
    ],
  },
  // --- Upcoming (cancellation window still open) ---
  {
    id: "reformer-thu-9",
    name: "Reformer Pilates",
    time: "Thu 09:00",
    instructor: "Sarah",
    capacity: 4,
    lifecycle: "upcoming",
    cancellationWindowClosed: false,
    attendees: [
      { name: "Emma Kelly", memberId: "emma-kelly", status: "booked" },
      { name: "Niamh Walsh", memberId: "niamh-walsh", status: "booked" },
      { name: "Orla Duffy", memberId: "orla-duffy", status: "booked" },
    ],
  },
];
