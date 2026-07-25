/**
 * Step 3 (staff accounts): proves AccountService.changePassword's
 * self-service guarantees against a real row — wrong current password is
 * rejected, a correct change clears mustChangePassword, and
 * passwordChangedAt advances (the same version-bump auth.ts's jwt()
 * callback uses to invalidate a token issued before this change).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../../lib/prisma";
import { accountService } from "./account.service";
import { employeeService } from "../employee/employee.service";

const TEST_USERNAME_PREFIX = "it-changepw-";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const username = `${TEST_USERNAME_PREFIX}${Date.now()}`;

  const { employee, tempPassword } = await employeeService.createEmployee(
    { firstName: "Change", lastName: "Password", username, roleId: role.id },
    owner.id,
  );
  const beforeChange = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });

  const wrongAttempt = await accountService.changePassword(employee.userId, {
    currentPassword: "definitely-not-it",
    newPassword: "NewPassword123!",
    confirmPassword: "NewPassword123!",
  });
  assert(!wrongAttempt.ok, "a wrong current password must be rejected");

  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
  assert(
    await bcrypt.compare(tempPassword, unchanged.passwordHash ?? ""),
    "a rejected change must leave the original password hash untouched",
  );
  console.log("PASS: changePassword rejects a wrong current password and leaves the hash untouched.");

  await new Promise((resolve) => setTimeout(resolve, 5));

  const correctAttempt = await accountService.changePassword(employee.userId, {
    currentPassword: tempPassword,
    newPassword: "NewPassword123!",
    confirmPassword: "NewPassword123!",
  });
  assert(correctAttempt.ok, "a correct current password must succeed");

  const afterChange = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
  assert(afterChange.mustChangePassword === false, "expected mustChangePassword cleared after a self-service change");
  assert(
    afterChange.passwordChangedAt!.getTime() > beforeChange.passwordChangedAt!.getTime(),
    "expected passwordChangedAt to advance — this is what invalidates this user's other sessions",
  );
  assert(
    await bcrypt.compare("NewPassword123!", afterChange.passwordHash ?? ""),
    "expected the new password to actually be stored",
  );
  assert(
    !(await bcrypt.compare(tempPassword, afterChange.passwordHash ?? "")),
    "the OLD temp password must no longer work after a self-service change",
  );
  console.log("PASS: a correct change clears mustChangePassword, advances passwordChangedAt, and the old password stops working.");

  const auditEntry = await prisma.auditLog.findFirst({
    where: { entityType: "User", entityId: employee.userId, action: "user.password_changed" },
    orderBy: { createdAt: "desc" },
  });
  assert(auditEntry !== null, "expected a user.password_changed audit log entry");
  console.log("PASS: the self-service change is audit-logged.");

  await cleanUp();
  console.log("PASS: AccountService.changePassword's guarantees proven against a real row.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
