const upcomingClasses = [
  { name: "Reformer Pilates", time: "Mon 09:00", instructor: "Sarah", booked: 8, capacity: 12 },
  { name: "Spin Express", time: "Mon 12:30", instructor: "James", booked: 14, capacity: 16 },
  { name: "Yoga Flow", time: "Tue 07:00", instructor: "Aoife", booked: 6, capacity: 10 },
  { name: "HIIT Circuit", time: "Tue 18:00", instructor: "Mark", booked: 10, capacity: 10 },
  { name: "Barre Tone", time: "Wed 10:00", instructor: "Sarah", booked: 3, capacity: 8 },
  { name: "Reformer Pilates", time: "Thu 09:00", instructor: "Sarah", booked: 11, capacity: 12 },
];

export default function ClassesPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <button className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
          Add class
        </button>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {upcomingClasses.map((cls, i) => (
          <li
            key={i}
            className="flex flex-col gap-1 rounded-lg border border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{cls.name}</span>
              <span className="text-xs text-white/50">
                {cls.time} &middot; {cls.instructor}
              </span>
            </div>
            <span
              className={`mt-1 text-xs sm:mt-0 ${
                cls.booked >= cls.capacity ? "text-red-400" : "text-white/50"
              }`}
            >
              {cls.booked}/{cls.capacity} booked
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
