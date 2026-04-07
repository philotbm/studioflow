export type Attendee = {
  name: string;
  status: "booked" | "attended" | "late_cancel";
};

export type StudioClass = {
  id: string;
  name: string;
  time: string;
  instructor: string;
  booked: number;
  capacity: number;
  waitlistCount: number;
  attendees: Attendee[];
};

export const upcomingClasses: StudioClass[] = [
  {
    id: "reformer-mon-9",
    name: "Reformer Pilates",
    time: "Mon 09:00",
    instructor: "Sarah",
    booked: 8,
    capacity: 12,
    waitlistCount: 0,
    attendees: [
      { name: "Emma Kelly", status: "booked" },
      { name: "Ciara Byrne", status: "attended" },
      { name: "Niamh Walsh", status: "booked" },
      { name: "Orla Duffy", status: "attended" },
      { name: "Sinead Murphy", status: "booked" },
      { name: "Roisin Daly", status: "late_cancel" },
      { name: "Aisling Nolan", status: "booked" },
      { name: "Maeve Ryan", status: "attended" },
    ],
  },
  {
    id: "spin-mon-1230",
    name: "Spin Express",
    time: "Mon 12:30",
    instructor: "James",
    booked: 14,
    capacity: 16,
    waitlistCount: 0,
    attendees: [
      { name: "Declan Power", status: "attended" },
      { name: "Fiona Healy", status: "booked" },
      { name: "Conor Brady", status: "attended" },
      { name: "Laura Keane", status: "booked" },
    ],
  },
  {
    id: "yoga-tue-7",
    name: "Yoga Flow",
    time: "Tue 07:00",
    instructor: "Aoife",
    booked: 6,
    capacity: 10,
    waitlistCount: 0,
    attendees: [
      { name: "Saoirse Flynn", status: "booked" },
      { name: "Grainne Doyle", status: "attended" },
      { name: "Eimear Cahill", status: "booked" },
    ],
  },
  {
    id: "hiit-tue-1800",
    name: "HIIT Circuit",
    time: "Tue 18:00",
    instructor: "Mark",
    booked: 10,
    capacity: 10,
    waitlistCount: 3,
    attendees: [
      { name: "Sean Brennan", status: "attended" },
      { name: "Padraig Roche", status: "attended" },
      { name: "Cian O'Neill", status: "booked" },
      { name: "Dara Fitzpatrick", status: "late_cancel" },
      { name: "Eoin Gallagher", status: "attended" },
    ],
  },
  {
    id: "barre-wed-10",
    name: "Barre Tone",
    time: "Wed 10:00",
    instructor: "Sarah",
    booked: 3,
    capacity: 8,
    waitlistCount: 0,
    attendees: [
      { name: "Clodagh Murray", status: "booked" },
      { name: "Aoibhinn Smyth", status: "booked" },
      { name: "Deirdre Whelan", status: "booked" },
    ],
  },
  {
    id: "reformer-thu-9",
    name: "Reformer Pilates",
    time: "Thu 09:00",
    instructor: "Sarah",
    booked: 11,
    capacity: 12,
    waitlistCount: 0,
    attendees: [
      { name: "Emma Kelly", status: "booked" },
      { name: "Niamh Walsh", status: "attended" },
      { name: "Orla Duffy", status: "booked" },
    ],
  },
];
