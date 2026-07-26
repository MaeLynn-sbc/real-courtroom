/**
 * Gate 2 established the ownership check (an employeeId comparison,
 * distinct from the coaching:manage_own_availability PERMISSION — see
 * CoachAvailabilityOwnershipError's own comment). Part B relaxed its
 * default: ALLOW_CROSS_COACH_AVAILABILITY_EDITS in
 * coach-availability.service.ts is true right now (the two active
 * coaches are family who coordinate schedules directly), so this test
 * now proves the CURRENT allowed behavior — coach-to-coach edits and
 * admin-on-behalf-of-a-coach edits both succeed — while still proving
 * what did NOT change: the target employee must still be isCoach.
 *
 * The toggle's reversibility itself (flip it back to strict per-coach
 * ownership) was proven manually during development, the same way the
 * concurrency guard's proven-failing-first check was: temporarily
 * setting ALLOW_CROSS_COACH_AVAILABILITY_EDITS to false, re-running
 * this suite's cross-coach scenario and confirming
 * CoachAvailabilityOwnershipError fires again, then restoring true.
 * Not kept as a runtime toggle inside this file — same reasoning as
 * why the concurrency guard's "without the guard" run isn't preserved
 * as code either, just reported.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { coachAvailabilityService, NotACoachError } from "./coach-availability.service";

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

async function createCoach(username: string, isCoach: boolean, roleName = "RECEPTIONIST"): Promise<{ id: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "Coach", isCoach },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  await cleanUp();

  const coachA = await createCoach(`${TEST_USERNAME_PREFIX}a-${Date.now()}`, true);
  const coachB = await createCoach(`${TEST_USERNAME_PREFIX}b-${Date.now()}`, true);
  const notACoach = await createCoach(`${TEST_USERNAME_PREFIX}c-${Date.now()}`, false);

  const window = {
    startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9),
    endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 17),
  };

  // Coach A creates their own window — always allowed, toggle or not.
  const aWindow = await coachAvailabilityService.createWindow(
    { coachId: coachA.id, ...window },
    coachA.id,
    owner.id,
  );
  console.log("PASS: coach A can create their own availability window.");

  // Part B (item 1): coach B creates a window on COACH A'S calendar —
  // now allowed by default. Both hold the identical permission at the
  // role level; this is exactly the ownership dimension the toggle
  // relaxes.
  const crossCoachWindow = await coachAvailabilityService.createWindow(
    { coachId: coachA.id, ...window, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 18), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 20) },
    coachB.id,
    owner.id,
  );
  console.log("PASS: coach B can create a window on coach A's calendar (Part B default).");

  // Traceability (item 4): the audit entry for that cross-coach create
  // must record it as one, not indistinguishably from a self-edit.
  const crossCoachAudit = await prisma.auditLog.findFirst({
    where: { entityType: "CoachAvailabilityWindow", entityId: crossCoachWindow.id },
    orderBy: { createdAt: "desc" },
  });
  const crossCoachMetadata = crossCoachAudit?.metadata as { callerEmployeeId?: string; editingOwnCalendar?: boolean } | null;
  assert(crossCoachMetadata?.editingOwnCalendar === false, "expected the audit log to record this as NOT a self-edit");
  assert(crossCoachMetadata?.callerEmployeeId === coachB.id, "expected the audit log to record coach B as the actual caller");
  console.log("PASS: the cross-coach edit is recorded in the audit log as one, distinguishable from a self-edit.");

  // Coach B deleting coach A's window — also allowed now.
  await coachAvailabilityService.deleteWindow(crossCoachWindow.id, coachB.id, owner.id);
  const crossCoachDeleted = await prisma.coachAvailabilityWindow.findUnique({ where: { id: crossCoachWindow.id } });
  assert(crossCoachDeleted === null, "expected coach B's delete of coach A's window to succeed");
  console.log("PASS: coach B can delete coach A's window too.");

  // Part B (item 3): the non-coach OWNER editing a coach's calendar on
  // their behalf — "put me in this slot" — must also work.
  const adminCreatedWindow = await coachAvailabilityService.createWindow(
    { coachId: coachA.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 21), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 22) },
    ownerEmployee.id,
    owner.id,
  );
  const adminAudit = await prisma.auditLog.findFirst({
    where: { entityType: "CoachAvailabilityWindow", entityId: adminCreatedWindow.id },
    orderBy: { createdAt: "desc" },
  });
  const adminMetadata = adminAudit?.metadata as { editingOwnCalendar?: boolean } | null;
  assert(adminMetadata?.editingOwnCalendar === false, "expected the admin-on-behalf-of edit to be recorded as not a self-edit too");
  console.log("PASS: a non-coach admin (Owner) can create a window on a coach's behalf, also traced in the audit log.");

  // Unchanged by Part B: coach A deleting their OWN window still works.
  await coachAvailabilityService.deleteWindow(aWindow.id, coachA.id, owner.id);
  const deleted = await prisma.coachAvailabilityWindow.findUnique({ where: { id: aWindow.id } });
  assert(deleted === null, "coach A should be able to delete their own window");
  console.log("PASS: coach A can still delete their own window.");

  // Unchanged by Part B: the TARGET must still be isCoach, regardless
  // of who's asking — the toggle only widens "whose calendar," never
  // "can you edit a non-coach's calendar."
  let notCoachRejected = false;
  try {
    await coachAvailabilityService.createWindow({ coachId: notACoach.id, ...window }, notACoach.id, owner.id);
  } catch (error) {
    notCoachRejected = error instanceof NotACoachError;
  }
  assert(notCoachRejected, "expected an employee without isCoach to be rejected even managing their own record");

  let notCoachRejectedByAdmin = false;
  try {
    await coachAvailabilityService.createWindow({ coachId: notACoach.id, ...window }, ownerEmployee.id, owner.id);
  } catch (error) {
    notCoachRejectedByAdmin = error instanceof NotACoachError;
  }
  assert(notCoachRejectedByAdmin, "expected isCoach gating to hold even for the admin — Part B widens ownership, not the isCoach requirement");
  console.log("PASS: isCoach gating is untouched by Part B — a non-coach's calendar can't be created by anyone, coach or admin.");

  await cleanUp();
  console.log("PASS: Part B's cross-coach and admin-on-behalf-of allowances proven, with isCoach gating confirmed unchanged.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
