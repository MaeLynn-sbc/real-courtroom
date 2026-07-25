/**
 * Gate 2, item 3: "coach edits only their own availability windows" is an
 * employeeId ownership check, distinct from the coaching:manage_own_
 * availability PERMISSION (which only says "may reach this endpoint at
 * all"). Both coaches here hold the same permission (granted at the
 * Role level in prisma/seed.ts) — this proves the ownership check is
 * what actually stops coach B from touching coach A's windows, not the
 * permission.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import {
  coachAvailabilityService,
  CoachAvailabilityOwnershipError,
  NotACoachError,
} from "./coach-availability.service";

const TEST_USERNAME_PREFIX = "it-coachown-";
const TEST_DATE = new Date(2031, 4, 6);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createCoach(username: string, isCoach: boolean): Promise<{ id: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "Coach", isCoach },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  await cleanUp();

  const coachA = await createCoach(`${TEST_USERNAME_PREFIX}a-${Date.now()}`, true);
  const coachB = await createCoach(`${TEST_USERNAME_PREFIX}b-${Date.now()}`, true);
  const notACoach = await createCoach(`${TEST_USERNAME_PREFIX}c-${Date.now()}`, false);

  const window = {
    startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9),
    endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 17),
  };

  // Coach A creates their own window — allowed.
  const aWindow = await coachAvailabilityService.createWindow(
    { coachId: coachA.id, ...window },
    coachA.id,
    owner.id,
  );
  console.log("PASS: coach A can create their own availability window.");

  // Coach B tries to create a window ON COACH A'S BEHALF (coachId
  // mismatches callerEmployeeId) — both hold the identical permission at
  // the role level; only the ownership check can catch this.
  let ownershipRejected = false;
  try {
    await coachAvailabilityService.createWindow({ coachId: coachA.id, ...window }, coachB.id, owner.id);
  } catch (error) {
    ownershipRejected = error instanceof CoachAvailabilityOwnershipError;
  }
  assert(ownershipRejected, "expected coach B creating a window for coach A to be rejected by the ownership check");
  console.log("PASS: coach B cannot create a window on coach A's behalf.");

  // Coach B tries to DELETE coach A's window — also rejected.
  let deleteRejected = false;
  try {
    await coachAvailabilityService.deleteWindow(aWindow.id, coachB.id, owner.id);
  } catch (error) {
    deleteRejected = error instanceof CoachAvailabilityOwnershipError;
  }
  assert(deleteRejected, "expected coach B deleting coach A's window to be rejected by the ownership check");
  const stillExists = await prisma.coachAvailabilityWindow.findUnique({ where: { id: aWindow.id } });
  assert(stillExists !== null, "coach A's window must still exist after coach B's rejected delete attempt");
  console.log("PASS: coach B cannot delete coach A's window — it still exists.");

  // Coach A deleting their OWN window — allowed.
  await coachAvailabilityService.deleteWindow(aWindow.id, coachA.id, owner.id);
  const deleted = await prisma.coachAvailabilityWindow.findUnique({ where: { id: aWindow.id } });
  assert(deleted === null, "coach A should be able to delete their own window");
  console.log("PASS: coach A can delete their own window.");

  // isCoach gating: an employee without isCoach can't get a window at
  // all, even for themselves.
  let notCoachRejected = false;
  try {
    await coachAvailabilityService.createWindow({ coachId: notACoach.id, ...window }, notACoach.id, owner.id);
  } catch (error) {
    notCoachRejected = error instanceof NotACoachError;
  }
  assert(notCoachRejected, "expected an employee without isCoach to be rejected even managing their own record");
  console.log("PASS: an employee without isCoach cannot hold availability windows, even for themselves.");

  await cleanUp();
  console.log("PASS: ownership check and isCoach gating both proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
