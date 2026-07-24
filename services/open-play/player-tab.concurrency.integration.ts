/**
 * Review follow-up: "prove creditGame is still safe under concurrency."
 * Dropping the DB-level uniqueness on (tabId, gameAssignmentId) (see
 * player-tab.service.ts's creditGame comment, and schema.prisma's
 * TabLineItem.voidsLineItemId comment) moved idempotency to an
 * application-level check inside completeAssignment's transaction — a
 * check-then-act pattern unless something else serializes concurrent
 * calls for the same assignment.
 *
 * Fires N parallel completeAssignment calls against ONE ACTIVE assignment
 * and asserts exactly one ₱35 credit lands per participant, not N. Real
 * Postgres, real Prisma transactions, real SELECT ... FOR UPDATE row
 * locking (same established technique as
 * open-play-registration.concurrency.integration.ts) — no mocks.
 *
 * This is a tsx script, not a Jest test — see that file's comment for why
 * (Prisma 7's WASM query compiler can't load under Jest).
 *
 * Requires the dev database up (docker compose up -d).
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

const TEST_DATE = new Date(2031, 0, 28); // Tuesday — far enough out not to collide with real usage
const CONCURRENT_CALLS = 10;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: TEST_DATE },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { date: TEST_DATE } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: TEST_DATE } });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  const registrationIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
      TEST_DATE,
      { playerName: `Concurrency Credit ${i}`, phone: `09700000${i}`, skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(registration.id, owner.id);
    registrationIds.push(registration.id);
  }

  const assignment = await prisma.gameAssignment.create({
    data: { courtId: court.id, date: TEST_DATE, skillSpread: 0, source: "AUTO", status: "ACTIVE", startedAt: new Date() },
  });
  await Promise.all(
    registrationIds.map((registrationId) =>
      prisma.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId } }),
    ),
  );

  console.log(`Firing ${CONCURRENT_CALLS} concurrent completeAssignment calls against one ACTIVE assignment...`);

  const attempts = Array.from({ length: CONCURRENT_CALLS }, () =>
    openPlayRotationService.completeAssignment(assignment.id, owner.id),
  );
  const results = await Promise.allSettled(attempts);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert(fulfilled.length === 1, `expected exactly 1 completeAssignment call to succeed, got ${fulfilled.length}`);
  assert(
    rejected.length === CONCURRENT_CALLS - 1,
    `expected ${CONCURRENT_CALLS - 1} calls to be rejected (already DONE), got ${rejected.length}`,
  );

  for (const registrationId of registrationIds) {
    const tab = await prisma.playerTab.findUniqueOrThrow({ where: { registrationId } });
    const gameLineItems = await prisma.tabLineItem.findMany({
      where: { tabId: tab.id, gameAssignmentId: assignment.id, type: "GAME" },
    });
    assert(
      gameLineItems.length === 1,
      `expected exactly 1 GAME line item for registration ${registrationId}, got ${gameLineItems.length} — ` +
        `a double credit means the app-level idempotency check in creditGame raced past the FOR UPDATE lock`,
    );
    assert(
      gameLineItems[0].amountCents === 3500,
      `expected the single credit to be ₱35, got ${gameLineItems[0].amountCents}`,
    );
  }

  const assignmentAfter = await prisma.gameAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert(assignmentAfter.status === "DONE", `expected the assignment to end DONE, got ${assignmentAfter.status}`);

  await cleanUp();

  console.log(
    `PASS — ${CONCURRENT_CALLS} concurrent completeAssignment calls against one assignment resolved to exactly ` +
      `1 success and exactly 1 credit per participant, never a double-credit.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
