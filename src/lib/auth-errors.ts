/**
 * v0.21.0.3 — typed auth errors for staff-side server actions.
 *
 * `requireRole()` in src/lib/auth.ts throws one of these when a
 * staff-gated server action runs without a valid session (AuthRequired)
 * or with a session whose role isn't permitted (Forbidden). Callers
 * that need to convert these into HTTP responses use the type guards.
 *
 * Throw-based on purpose: server actions return `void | Promise<void>`
 * with no clean way to short-circuit via a return value, and Next.js's
 * `redirect()` from `next/navigation` is itself implemented as a
 * thrown sentinel error — so throwing here matches the framework's
 * own control-flow convention.
 *
 * Recommended catch patterns:
 *
 *   // Server action / server component:
 *   try {
 *     const staff = await requireRole(['owner', 'manager']);
 *     // …
 *   } catch (e) {
 *     if (isAuthRequired(e)) redirect(e.redirectTo);
 *     if (isForbidden(e)) redirect('/app');
 *     throw e;
 *   }
 *
 *   // Route handler:
 *   try {
 *     const staff = await requireRole(['owner', 'manager']);
 *     // …
 *   } catch (e) {
 *     if (isAuthRequired(e)) {
 *       return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
 *     }
 *     if (isForbidden(e)) {
 *       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *     }
 *     throw e;
 *   }
 */

export class AuthRequired extends Error {
  constructor(public readonly redirectTo: string = "/staff/login") {
    super("Authentication required");
    this.name = "AuthRequired";
  }
}

export class Forbidden extends Error {
  constructor() {
    super("Forbidden");
    this.name = "Forbidden";
  }
}

export function isAuthRequired(e: unknown): e is AuthRequired {
  return e instanceof AuthRequired;
}

export function isForbidden(e: unknown): e is Forbidden {
  return e instanceof Forbidden;
}
