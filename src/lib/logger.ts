/**
 * v0.21.0.4 — structured logger.
 *
 * Emits one JSON line per call to stdout. Vercel ingests stdout
 * natively; future swap to Axiom/Logtail/Logflare is a config change,
 * not a codebase rewrite.
 *
 * Use in src/app/api/** for breadcrumbs you want before things break.
 * Sentry catches exceptions automatically — don't duplicate them
 * here.
 *
 * Convention: `event` is a required snake_case identifier you'd grep
 * on later (e.g. "checkin_success", "stripe_signature_verify_failed").
 * Do NOT log PII (email, phone, last4).
 *
 * Zero dependencies on purpose — edge-runtime compatible and won't
 * pull Sentry into bundles that don't need it.
 */

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMeta = Record<string, unknown> & { event: string };

function emit(level: LogLevel, meta: LogMeta): void {
  const payload = { ts: new Date().toISOString(), level, ...meta };
  console.log(JSON.stringify(payload));
}

export const logger = {
  debug: (meta: LogMeta) => emit("debug", meta),
  info: (meta: LogMeta) => emit("info", meta),
  warn: (meta: LogMeta) => emit("warn", meta),
  error: (meta: LogMeta) => emit("error", meta),
};
