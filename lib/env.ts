import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().min(1).optional(),
  FEATURE_PAYMENTS: z.string().default("false"),
  FEATURE_OPEN_PLAY: z.string().default("false"),
  FEATURE_TOURNAMENTS: z.string().default("false"),
  FEATURE_MEMBERSHIPS: z.string().default("false"),
  FEATURE_EQUIPMENT_RENTALS: z.string().default("false"),
  PAYMENT_PROVIDER: z.enum(["local"]).default("local"),
  EMAIL_PROVIDER: z.enum(["console"]).default("console"),
  UPLOAD_PROVIDER: z.enum(["local"]).default("local"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Validated before the logger exists (the logger itself reads env), so this
  // is the one deliberate exception to the "no console.log" rule in the app.
  //
  // Deploy prep: a `throw` here surfaces as an uncaught exception — Node
  // prints the message buried inside a full stack trace before exiting.
  // An operator scanning container boot logs needs the message to BE the
  // output, not a line inside one — this is a startup config error, not
  // a bug with a call stack worth inspecting. `process.exit(1)` after an
  // explicit console.error is a hard fail with nothing else printed.
  console.error(
    "Invalid environment variables:",
    z.treeifyError(parsed.error),
  );
  console.error(
    "Invalid environment variables. Check .env against .env.example.",
  );
  process.exit(1);
}

export const env = parsed.data;

// BUILD-SPEC.md §0 "Timezone: date-only values assume TZ=Asia/Manila" —
// every date-only value in this app (OpenPlayNightSession.date,
// OpenPlayNightRegistration.date, QueueEntry.date, ...) is built with
// `new Date(y, m, d)`, JS local-timezone midnight, and a hand-written
// Postgres CHECK constraint (prisma/migrations/12_fix_registration_weekday
// _check_timezone/) assumes that construction always means PH-local
// midnight by hardcoding a fixed +8 offset. If this process ever runs in a
// different timezone, both the app's own date math and that constraint's
// weekday check go wrong together, silently — an off-by-one-day bug that
// only shows up on database writes, not in a type check or a unit test.
// Checking the numeric UTC offset (not the TZ string, which might be unset,
// "Asia/Manila", "+08:00", or any other equivalent no-DST UTC+8 zone) is
// what actually matters: the Philippines has never observed DST, so a flat
// +8 is exact year-round — this assertion, and the migration's hardcoded
// offset, would both need revisiting if this app is ever deployed outside
// the Philippines.
//
// "An assertion that isn't reached is not an assertion" — audited (Phase 7
// review) every entry point that can write app data: `next dev`/`next
// start` (this module is imported transitively by lib/prisma.ts, which
// nearly every server-side code path imports), `npm run db:seed`
// (prisma/seed.ts imports `env` directly), and every `*.integration.ts`
// script (each starts with `import "dotenv/config"` then imports
// lib/prisma.ts transitively, same as seed.ts — confirmed by grep, not
// assumed). `prisma migrate deploy`/`generate`/`studio` are Prisma's own
// CLI, not this app's code, and don't write app data. There is no
// worker/scheduler process (see DEVELOPER_ONBOARDING.md — this app has
// none) to audit separately. If a new entry point is ever added, it needs
// this same coverage.
const PHILIPPINE_TIMEZONE_OFFSET_MINUTES = -480; // UTC+8, getTimezoneOffset() is negative for zones ahead of UTC

function assertCorrectTimezone(): void {
  const actual = new Date().getTimezoneOffset();
  if (actual !== PHILIPPINE_TIMEZONE_OFFSET_MINUTES) {
    // `process.exit(1)` after an explicit console.error, not `throw` —
    // same reasoning as the env-schema check above. A wrong-TZ container
    // is a deploy misconfiguration an operator needs to see and fix
    // immediately on boot, not a stack trace to read through.
    console.error(
      `This process must run with a UTC+8, non-DST timezone (Asia/Manila) — ` +
        `every "date-only" value in this app, and a hand-written database ` +
        `CHECK constraint, assume it. Detected UTC offset ${-actual / 60}h ` +
        `instead. Set TZ=Asia/Manila in the environment before starting the ` +
        `app (see .env.example, Dockerfile).`,
    );
    process.exit(1);
  }
}

assertCorrectTimezone();
