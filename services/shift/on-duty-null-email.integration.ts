/**
 * Reported live: the "who's on duty" dropdown showed 0 people even
 * though staff had genuinely started shifts. listOpenShiftsWithEmployee
 * filtered `email: { not: WEBSITE_SYSTEM_USER_EMAIL }`, which compiles
 * to SQL `<>` — and `NULL <> 'x'` evaluates to UNKNOWN, not TRUE, so
 * Postgres excludes the row entirely. A staff account doesn't require
 * an email (features/employees/schemas/employee.schema.ts's own
 * comment), so this silently hid every such employee's open shift.
 * Confirmed against real production data before fixing.
 *
 * Proven failing-first would mean this test failing against the
 * pre-fix code (an employee with no email never appears); it must pass
 * now.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { WEBSITE_SYSTEM_USER_EMAIL } from "../../lib/system-identities";
import { shiftService } from "./shift.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "it-onduty-nullemail-";

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  await prisma.shift.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  try {
    const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
    const suffix = Date.now();

    // Deliberately NO email — the exact real-world shape that triggered
    // the bug. No `email` field passed at all, matching how a real
    // staff account is created without one.
    const noEmailUser = await prisma.user.create({
      data: { name: `${TEST_USERNAME_PREFIX}noemail-${suffix}`, username: `${TEST_USERNAME_PREFIX}noemail-${suffix}`, roleId: role.id },
    });
    const noEmailEmployee = await prisma.employee.create({
      data: { userId: noEmailUser.id, employeeNumber: `${TEST_USERNAME_PREFIX}noemail-${suffix}-num`, firstName: "No", lastName: "Email" },
    });
    assert(noEmailUser.email === null, "expected the test user to genuinely have no email, matching the real bug shape");

    const shift = await shiftService.startShift(noEmailEmployee.id, { openingCashCents: 0 }, noEmailUser.id);

    const onDuty = await shiftService.listOpenShiftsWithEmployee();
    assert(
      onDuty.some((s) => s.id === shift.id),
      "expected an employee with no email to appear in the on-duty list — this is the exact bug reported live",
    );
    console.log("PASS: an employee with no email on file appears in the on-duty list.");

    // Regression: the website system identity's own perpetual shift must
    // still be excluded — the fix must not turn this into "show everyone."
    const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: WEBSITE_SYSTEM_USER_EMAIL } });
    const websiteEmployee = await prisma.employee.findFirstOrThrow({ where: { userId: websiteUser.id } });
    assert(
      !onDuty.some((s) => s.employeeId === websiteEmployee.id),
      "expected the Website system identity's own shift to stay excluded from the on-duty list",
    );
    console.log("PASS: the Website system identity's perpetual shift is still excluded.");

    await cleanUp();
    console.log("\nPASS: on-duty null-email bug proven fixed against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
