/**
 * BUILD-SPEC.md §5's mandatory concurrency test: "10 concurrent
 * registrations against capacity 5 → exactly 5 confirmed, 5 waitlisted."
 * Real Postgres, real Prisma transactions, real SELECT ... FOR UPDATE row
 * locking — no mocks.
 *
 * This is a tsx script, not a Jest test, for one deliberate reason:
 * Jest's default (and every transformIgnorePatterns variant tried) fails
 * to load Prisma 7's WASM query compiler —
 * `@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs` is
 * dynamically `import()`-ed from inside Prisma's own generated client
 * code, and Jest's CJS-based module system chokes on that regardless of
 * transform config (confirmed with two different transformIgnorePatterns
 * configs; both fail identically deep inside
 * WasmQueryCompilerLoader.ts, not in any app code). tsx uses real Node
 * ESM/dynamic-import support and has run every other live-DB
 * verification this project needed all session without issue, so this
 * script is that same real runtime, checked in and rerunnable, instead
 * of a fragile Jest workaround. Exits non-zero on any failed assertion,
 * so `npm run test:integration` is CI-usable.
 *
 * Requires the dev database up (docker compose up -d).
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

const TEST_SESSION_DATE = new Date(2031, 0, 3); // Friday, Jan 3 2031 — far enough out not to collide with real usage
const TEST_CAPACITY = 5;
const CONCURRENT_REGISTRATIONS = 10;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_SESSION_DATE } });
  if (existing) {
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  await cleanUpTestSession();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const session = await prisma.openPlayNightSession.create({
    data: {
      date: TEST_SESSION_DATE,
      startAt: new Date(2031, 0, 3, 18, 0),
      endAt: new Date(2031, 0, 3, 23, 0),
      capacity: TEST_CAPACITY,
    },
  });

  console.log(`Firing ${CONCURRENT_REGISTRATIONS} concurrent registrations against capacity ${TEST_CAPACITY}...`);

  const attempts = Array.from({ length: CONCURRENT_REGISTRATIONS }, (_, index) =>
    openPlayRegistrationService.registerWalkIn(
      session.id,
      {
        playerName: `Concurrency Test ${index}`,
        phone: `0900000${String(index).padStart(4, "0")}`,
        skillLevel: "INTERMEDIATE",
      },
      owner.id,
    ),
  );

  const results = await Promise.all(attempts);

  const seated = results.filter((r) => r.status === "CONFIRMED" && r.waitlistPos === null);
  const waitlisted = results.filter((r) => r.waitlistPos !== null);

  assert(seated.length === 5, `expected 5 seated (confirmed), got ${seated.length}`);
  assert(waitlisted.length === 5, `expected 5 waitlisted, got ${waitlisted.length}`);
  assert(
    new Set(results.map((r) => r.id)).size === CONCURRENT_REGISTRATIONS,
    "expected 10 distinct registration rows — a duplicate id would mean two attempts collapsed into one",
  );

  const waitlistPositions = waitlisted.map((r) => r.waitlistPos).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert(
    JSON.stringify(waitlistPositions) === JSON.stringify([1, 2, 3, 4, 5]),
    `expected waitlist positions [1,2,3,4,5], got ${JSON.stringify(waitlistPositions)}`,
  );

  const seatedInDb = await prisma.openPlayNightRegistration.count({
    where: { sessionId: session.id, status: "CONFIRMED", waitlistPos: null },
  });
  assert(seatedInDb === 5, `expected 5 seated rows in the database directly, got ${seatedInDb}`);

  await cleanUpTestSession();

  console.log("PASS — 10 concurrent registrations against capacity 5 resolved to exactly 5 confirmed, 5 waitlisted.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUpTestSession().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
