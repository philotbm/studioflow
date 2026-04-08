export type Attendee = {
  name: string;
  memberId?: string;
  status: "booked" | "attended" | "late_cancel" | "no_show" | "checked_in" | "not_checked_in";
  // Set by the promotions transform when an attendee was lifted off the
  // waitlist. Preserves the original waitlist position so the Unpromote
  // action can revert cleanly.
  promotedFromPosition?: number;
  // How the promotion happened:
  //   "manual" — recorded in the cookie event log via promoteWaitlistEntry
  //   "auto"   — derived every render by the FIFO auto-promotion pass,
  //              never written to the cookie, has no Undo action
  promotionType?: "manual" | "auto";
};

export type Lifecycle = "upcoming" | "live" | "completed";

export type WaitlistEntry = {
  name: string;
  memberId?: string;
  position: number;
};

export type StudioClass = {
  id: string;
  name: string;
  time: string;
  instructor: string;
  booked: number;
  capacity: number;
  waitlistCount: number;
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
    booked: 8,
    capacity: 12,
    waitlistCount: 0,
    lifecycle: "completed",
    attendees: [
      { name: "Emma Kelly", memberId: "emma-kelly", status: "attended" },
      { name: "Ciara Byrne", memberId: "ciara-byrne", status: "attended" },
      { name: "Niamh Walsh", status: "attended" },
      { name: "Orla Duffy", status: "attended" },
      { name: "Sinead Murphy", status: "no_show" },
      { name: "Roisin Daly", status: "late_cancel" },
      { name: "Aisling Nolan", status: "attended" },
      { name: "Maeve Ryan", status: "attended" },
    ],
  },
  // --- Live ---
  {
    id: "spin-mon-1230",
    name: "Spin Express",
    time: "Mon 12:30",
    instructor: "James",
    booked: 14,
    capacity: 16,
    waitlistCount: 0,
    lifecycle: "live",
    attendees: [
      { name: "Declan Power", memberId: "declan-power", status: "checked_in" },
      { name: "Fiona Healy", memberId: "fiona-healy", status: "not_checked_in" },
      { name: "Conor Brady", memberId: "conor-brady", status: "checked_in" },
      { name: "Laura Keane", status: "not_checked_in" },
      { name: "Brendan Quinn", status: "checked_in" },
      { name: "Shauna Reid", status: "checked_in" },
      { name: "Kevin Molloy", status: "not_checked_in" },
      { name: "Aidan Cullen", status: "checked_in" },
      { name: "Michelle O'Rourke", status: "checked_in" },
      { name: "Paul Sweeney", status: "not_checked_in" },
      { name: "Emer Fahey", status: "checked_in" },
      { name: "Ruairi Coyle", status: "checked_in" },
      { name: "Isabel Burke", status: "checked_in" },
      { name: "Diarmuid Hayes", status: "checked_in" },
    ],
  },
  // --- Completed ---
  {
    id: "yoga-tue-7",
    name: "Yoga Flow",
    time: "Tue 07:00",
    instructor: "Aoife",
    booked: 6,
    capacity: 10,
    waitlistCount: 0,
    lifecycle: "completed",
    attendees: [
      { name: "Saoirse Flynn", memberId: "saoirse-flynn", status: "attended" },
      { name: "Grainne Doyle", status: "attended" },
      { name: "Eimear Cahill", status: "no_show" },
      { name: "Sile Brennan", status: "attended" },
      { name: "Brigid Moran", status: "attended" },
      { name: "Cathal Donnelly", status: "attended" },
    ],
  },
  // --- Upcoming (cancellation window closed — one spot open, waitlist running) ---
  {
    id: "hiit-tue-1800",
    name: "HIIT Circuit",
    time: "Tue 18:00",
    instructor: "Mark",
    booked: 9,
    capacity: 10,
    waitlistCount: 3,
    lifecycle: "upcoming",
    cancellationWindowClosed: true,
    attendees: [
      { name: "Sean Brennan", memberId: "sean-brennan", status: "booked" },
      { name: "Padraig Roche", memberId: "padraig-roche", status: "booked" },
      { name: "Cian O'Neill", status: "booked" },
      { name: "Eoin Gallagher", status: "booked" },
      { name: "Shane O'Connor", status: "booked" },
      { name: "Niall McCarthy", status: "booked" },
      { name: "Tomas Lenehan", status: "booked" },
      { name: "Fionnuala Darcy", status: "booked" },
      { name: "Caoimhe Barrett", status: "booked" },
    ],
    waitlist: [
      { name: "Saoirse Flynn", memberId: "saoirse-flynn", position: 1 },
      { name: "Aoife Nolan", memberId: "aoife-nolan", position: 2 },
      { name: "Ailbhe Connolly", position: 3 },
    ],
  },
  // --- Upcoming (cancellation window still open) ---
  {
    id: "barre-wed-10",
    name: "Barre Tone",
    time: "Wed 10:00",
    instructor: "Sarah",
    booked: 3,
    capacity: 8,
    waitlistCount: 0,
    lifecycle: "upcoming",
    cancellationWindowClosed: false,
    attendees: [
      { name: "Clodagh Murray", memberId: "clodagh-murray", status: "booked" },
      { name: "Aoibhinn Smyth", status: "booked" },
      { name: "Deirdre Whelan", status: "booked" },
    ],
  },
  // --- Upcoming (cancellation window still open) ---
  {
    id: "reformer-thu-9",
    name: "Reformer Pilates",
    time: "Thu 09:00",
    instructor: "Sarah",
    booked: 11,
    capacity: 12,
    waitlistCount: 0,
    lifecycle: "upcoming",
    cancellationWindowClosed: false,
    attendees: [
      { name: "Emma Kelly", memberId: "emma-kelly", status: "booked" },
      { name: "Niamh Walsh", status: "booked" },
      { name: "Orla Duffy", status: "booked" },
      { name: "Maeve Ryan", status: "booked" },
      { name: "Roisin Daly", status: "booked" },
      { name: "Aisling Nolan", status: "booked" },
      { name: "Sinead Murphy", status: "booked" },
      { name: "Brid Costello", status: "booked" },
      { name: "Una Mac Mahon", status: "booked" },
      { name: "Grace Foley", status: "booked" },
      { name: "Laoise Tierney", status: "booked" },
    ],
  },
];
