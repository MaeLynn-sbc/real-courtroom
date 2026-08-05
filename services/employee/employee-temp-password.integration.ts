/**
 * Step 3 (staff accounts): proves the temp-password behavior against real
 * rows — createEmployee and resetPassword must both (a) never let the
 * caller choose the password, (b) return a plaintext value whose bcrypt
 * hash is exactly what landed in the database, and (c) set
 * mustChangePassword true + bump passwordChangedAt every time.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../../lib/prisma";
import { employeeService } from "./employee.service";

const TEST_USERNAME_PREFIX = "it-temppw-";

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
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const username = `${TEST_USERNAME_PREFIX}${Date.now()}`;

  const { employee, tempPassword } = await employeeService.createEmployee(
    { firstName: "Temp", lastName: "Password", username, roleId: role.id },
    owner.id,
  );

  let user = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
  assert(user.mustChangePassword === true, "expected mustChangePassword true right after creation");
  assert(user.passwordChangedAt !== null, "expected passwordChangedAt to be stamped at creation");
  assert(
    await bcrypt.compare(tempPassword, user.passwordHash ?? ""),
    "the returned plaintext temp password must match the stored hash",
  );
  console.log("PASS: createEmployee sets mustChangePassword, stamps passwordChangedAt, and returns the exact password it hashed.");

  const firstPasswordChangedAt = user.passwordChangedAt!.getTime();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const resetResult = await employeeService.resetPassword(employee.id, owner.id);
  assert(resetResult.tempPassword !== tempPassword, "a reset must generate a NEW temp password, not repeat the old one");

  user = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
  assert(user.mustChangePassword === true, "expected mustChangePassword true again after an admin reset");
  assert(
    user.passwordChangedAt!.getTime() > firstPasswordChangedAt,
    "expected passwordChangedAt to advance on reset — this is what invalidates other active sessions",
  );
  assert(
    await bcrypt.compare(resetResult.tempPassword, user.passwordHash ?? ""),
    "the reset's returned plaintext password must match the newly stored hash",
  );
  assert(
    !(await bcrypt.compare(tempPassword, user.passwordHash ?? "")),
    "the OLD temp password must no longer match after a reset",
  );
  console.log("PASS: resetPassword generates a fresh temp password, re-arms mustChangePassword, and advances passwordChangedAt.");

  await cleanUp();
  console.log("PASS: temp-password behavior proven against real createEmployee/resetPassword rows, not just reasoned about.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
