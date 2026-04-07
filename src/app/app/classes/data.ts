export type Attendee = {
  name: string;
  status: "booked" | "attended" | "late_cancel" | "no_show";
};

export type Lifecycle = "upcoming" | "live" | "completed";

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
      { name: "Emma Kelly", status: "attended" },
      { name: "Ciara Byrne", status: "attended" },
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
      { name: "Declan Power", status: "attended" },
      { name: "Fiona Healy", status: "booked" },
      { name: "Conor Brady", status: "attended" },
      { name: "Laura Keane", status: "booked" },
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
      { name: "Saoirse Flynn", status: "attended" },
      { name: "Grainne Doyle", status: "attended" },
      { name: "Eimear Cahill", status: "no_show" },
    ],
  },
  // --- Upcoming (cancellation window closed — late cancel applies) ---
  {
    id: "hiit-tue-1800",
    name: "HIIT Circuit",
    time: "Tue 18:00",
    instructor: "Mark",
    booked: 10,
    capacity: 10,
    waitlistCount: 3,
    lifecycle: "upcoming",
    cancellationWindowClosed: true,
    attendees: [
      { name: "Sean Brennan", status: "booked" },
      { name: "Padraig Roche", status: "booked" },
      { name: "Cian O'Neill", status: "booked" },
      { name: "Dara Fitzpatrick", status: "late_cancel" },
      { name: "Eoin Gallagher", status: "booked" },
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
      { name: "Clodagh Murray", status: "booked" },
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
      { name: "Emma Kelly", status: "booked" },
      { name: "Niamh Walsh", status: "booked" },
      { name: "Orla Duffy", status: "booked" },
    ],
  },
];
