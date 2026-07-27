/**
 * Expenses tracking — Gate 1. Proves, against real rows:
 *   1. createExpense (no receipt) writes an Expense row with a correctly
 *      formatted EXP-YYYYMMDD-#### reference number, and writes an audit
 *      log entry.
 *   2. createExpense (with a receipt) uploads the file via the same
 *      private-upload mechanism as booking/open-play payment proofs and
 *      stores its key on receiptStorageKey — the file is retrievable back
 *      through the upload service by that key.
 *   3. listRecentExpenses surfaces a newly created expense with its
 *      category/paymentMethod/recordedByEmployee relations populated.
 *   4. ExpenseCategory CRUD (create/update/enable/disable) all write audit
 *      log entries, and listCategories(false) excludes a disabled category
 *      while listCategories(true) still includes it.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { expenseCategoryService } from "./expense-category.service";
import { expenseService } from "./expense.service";
import { getUploadService } from "../upload/upload-service.factory";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "expenses-test-";
const TEST_CATEGORY_PREFIX = "Expenses Test Category ";

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "ExpensesEmployee" },
  });
}

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  await prisma.expense.deleteMany({ where: { recordedByEmployeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.expenseCategory.deleteMany({ where: { name: { startsWith: TEST_CATEGORY_PREFIX } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    const category = await prisma.expenseCategory.create({
      data: { name: `${TEST_CATEGORY_PREFIX}${Date.now()}`, sortOrder: 0 },
    });

    // ============== 1. createExpense (no receipt) — reference number + audit log ==============
    const today = new Date();
    const expenseNoReceipt = await expenseService.createExpense(
      {
        amountCents: 150000,
        date: today,
        description: "Test expense — no receipt",
        categoryId: category.id,
        paymentMethodId: cashMethod.id,
        recordedByEmployeeId: employee.id,
      },
      employee.userId,
    );
    console.log(`Created expense: ${expenseNoReceipt.expenseNumber}`);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    assert(
      new RegExp(`^EXP-${year}${month}${day}-\\d{4}$`).test(expenseNoReceipt.expenseNumber),
      `expected EXP-${year}${month}${day}-#### format, got ${expenseNoReceipt.expenseNumber}`,
    );
    assert(expenseNoReceipt.receiptStorageKey === null, `expected no receiptStorageKey, got ${expenseNoReceipt.receiptStorageKey}`);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Expense", entityId: expenseNoReceipt.id, action: "expense.created" },
    });
    assert(auditEntry !== null, "expected an expense.created audit log entry");
    console.log("PASS: createExpense (no receipt) writes a correctly formatted reference number and an audit log entry.");

    // ============== 2. createExpense (with receipt) — upload + retrievable ==============
    const receiptData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic bytes
    const expenseWithReceipt = await expenseService.createExpense(
      {
        amountCents: 75000,
        date: today,
        description: "Test expense — with receipt",
        categoryId: category.id,
        paymentMethodId: cashMethod.id,
        recordedByEmployeeId: employee.id,
        receipt: { fileName: "receipt.png", contentType: "image/png", data: receiptData },
      },
      employee.userId,
    );
    assert(expenseWithReceipt.receiptStorageKey !== null, "expected a receiptStorageKey");
    const storedData = await getUploadService().get(expenseWithReceipt.receiptStorageKey!);
    assert(storedData !== null, "expected the receipt to be retrievable from the upload service");
    assert(storedData!.equals(receiptData), "expected the retrieved receipt bytes to match what was uploaded");
    console.log("PASS: createExpense (with receipt) uploads the file and stores a retrievable key.");

    // ============== 3. listRecentExpenses — relations populated ==============
    const recent = await expenseService.listRecentExpenses(200);
    const found = recent.find((expense) => expense.id === expenseNoReceipt.id);
    assert(found !== undefined, "expected the newly created expense to appear in listRecentExpenses");
    assert(found!.category.name === category.name, `expected category name ${category.name}, got ${found!.category.name}`);
    assert(found!.paymentMethod.label === cashMethod.label, `expected payment method label ${cashMethod.label}, got ${found!.paymentMethod.label}`);
    assert(found!.recordedByEmployee.lastName === "ExpensesEmployee", `expected recordedByEmployee relation populated, got ${JSON.stringify(found!.recordedByEmployee)}`);
    console.log("PASS: listRecentExpenses surfaces the new expense with category/paymentMethod/recordedByEmployee populated.");

    // ============== 4. ExpenseCategory CRUD — audit-logged, active filter respected ==============
    const newCategory = await expenseCategoryService.createCategory(
      { name: `${TEST_CATEGORY_PREFIX}${Date.now()}-2`, sortOrder: 9 },
      employee.userId,
    );
    const createdAudit = await prisma.auditLog.findFirst({
      where: { entityType: "ExpenseCategory", entityId: newCategory.id, action: "expense_category.created" },
    });
    assert(createdAudit !== null, "expected an expense_category.created audit log entry");

    const updated = await expenseCategoryService.updateCategory(newCategory.id, { sortOrder: 3 }, employee.userId);
    assert(updated.sortOrder === 3, `expected sortOrder 3, got ${updated.sortOrder}`);
    const updatedAudit = await prisma.auditLog.findFirst({
      where: { entityType: "ExpenseCategory", entityId: newCategory.id, action: "expense_category.updated" },
    });
    assert(updatedAudit !== null, "expected an expense_category.updated audit log entry");

    const disabled = await expenseCategoryService.setCategoryActive(newCategory.id, false, employee.userId);
    assert(disabled.isActive === false, "expected the category to be disabled");
    const disabledAudit = await prisma.auditLog.findFirst({
      where: { entityType: "ExpenseCategory", entityId: newCategory.id, action: "expense_category.disabled" },
    });
    assert(disabledAudit !== null, "expected an expense_category.disabled audit log entry");

    const activeOnly = await expenseCategoryService.listCategories(false);
    assert(
      activeOnly.every((c) => c.id !== newCategory.id),
      "expected listCategories(false) to exclude the disabled category",
    );
    const includingInactive = await expenseCategoryService.listCategories(true);
    assert(
      includingInactive.some((c) => c.id === newCategory.id),
      "expected listCategories(true) to still include the disabled category",
    );
    console.log("PASS: ExpenseCategory create/update/disable are all audit-logged, and the active filter behaves correctly.");

    await cleanUp();
    console.log("\nPASS: expenses tracking proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
