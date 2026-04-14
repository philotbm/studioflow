# StudioFlow v0.4.8 — Supabase Setup

## 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) and create a new project.

## 2. Configure environment variables
Copy `.env.local.example` to `.env.local` and fill in your credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Find these in your Supabase dashboard under **Settings > API**.

## 3. Run the schema
Open the **SQL Editor** in your Supabase dashboard and run the contents of `supabase/schema.sql`.

## 4. Run the seed data
In the same SQL Editor, run the contents of `supabase/seed.sql`.

## 5. Disable RLS (for now)
This release does not include authentication. Ensure Row Level Security is **disabled** on all four tables:
- `members`
- `classes`
- `class_bookings`
- `booking_events`

Or if RLS is enabled, add a permissive policy:
```sql
alter table members enable row level security;
create policy "Allow all" on members for all using (true) with check (true);
-- Repeat for classes, class_bookings, booking_events
```

## 6. Install dependencies
```bash
npm install
```

## 7. Start the dev server
```bash
npm run dev
```

Navigate to `http://localhost:3000/app/classes` to verify data loads from Supabase.
