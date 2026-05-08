# StudioFlow — Supabase Setup

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
Open the **SQL Editor** in your Supabase dashboard and run the contents of `supabase/schema.sql`. Then apply each `supabase/v*_migration.sql` file in version order — the schema baseline already includes everything through the latest migration, but if you're upgrading an existing project from an earlier release run only the migration files added since.

## 4. Run the seed data
In the same SQL Editor, run the contents of `supabase/seed.sql`.

## 5. RLS posture
RLS is **off** on the data tables (`members`, `classes`, `class_bookings`, `booking_events`, `purchases`, `plans`, `credit_transactions`) — M4 turns this on across the schema.

RLS **is on** for `staff` (added in v0.21.0 / M2) with a single self-read policy so each staff user can resolve their own role via the SSR client.

If you have RLS enabled on a data table during development, add a permissive policy so the app keeps working until M4:
```sql
alter table members enable row level security;
create policy "Allow all" on members for all using (true) with check (true);
-- Repeat for classes, class_bookings, booking_events, etc.
```

## 6. Bootstrap the first staff user (v0.21.0+)

`/app/*`, `/instructor/*`, and `/api/admin/*` are gated by the proxy added in M2. To reach them, your auth user must have a row in the `staff` table.

The seed inserts Phil (`philotbm@gmail.com`) as `owner`, but **only if he's already signed in once** — `auth.users` doesn't get a row until the first magic-link sign-in. If `/app` returns a redirect loop on first run:

1. Visit `/staff/login`, enter the owner email, click the magic link.
2. The callback will redirect you to `/staff/login?error=not-authorised` (no staff row yet — expected).
3. Re-run `supabase/seed.sql` in the SQL Editor; it now finds your `auth.users` row and inserts the owner staff row.
4. Visit `/staff/login` again, request a fresh magic link, and you'll land at `/app`.

### Adding more staff before an invite UX exists

```sql
INSERT INTO staff (user_id, full_name, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'newstaff@example.com'),
  'New Staff',
  'instructor'   -- or 'manager' or 'owner'
);
```

The user must sign in via `/staff/login` at least once first so their `auth.users` row exists.

## 7. Install dependencies
```bash
npm install
```

## 8. Start the dev server
```bash
npm run dev
```

- Member surface: `/login` → `/my/{slug}`
- Staff surface: `/staff/login` → `/app`
