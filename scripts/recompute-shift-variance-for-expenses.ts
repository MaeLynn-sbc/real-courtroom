import "dotenv/config";
import { prisma } from "../lib/prisma";
import { expenseService } from "../services/expenses/expense.service";

// One-off (2026-09-25): shift close used to leave cash expenses out of
// "expected cash", so every shift that paid an expense from the drawer
// closed as a deficit of exactly that amount (e.g. Lovely Joy Faith Sonio,
// Sep 24: "Deficit ₱506.00" while the day reconciled as Balanced).
//
// Adds back only the cash expenses keyed in during each shift. It does NOT
// recompute from scratch: sales voided or edited after a close would then
// silently move variances that have nothing to do with this fix.
//
// Dry run by default. `npx tsx scripts/recompute-shift-variance-for-expenses.ts --apply`
// writes the change plus an audit log row per shift. Delete this file after.
async function main() {
  const apply = process.argv.includes("--apply");
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const shifts = await prisma.shift.findMany({
    where: { status: "CLOSED", varianceCents: { not: null }, endedAt: { not: null } },
    include: { employee: true },
    orderBy: { startedAt: "asc" },
  });

  let changed = 0;
  for (const shift of shifts) {
    const expensesCents = await expenseService.getCashExpensesBetween(shift.startedAt, shift.endedAt!);
    if (expensesCents === 0) continue;
    const oldVariance = shift.varianceCents!;
    const newVariance = oldVariance + expensesCents;
    changed++;
    console.log(
      `${shift.shiftNumber}  ${shift.employee.firstName} ${shift.employee.lastName}  ` +
        `${(oldVariance / 100).toFixed(2)} -> ${(newVariance / 100).toFixed(2)}  (cash expenses ${(expensesCents / 100).toFixed(2)})`,
    );
    if (!apply) continue;
    await prisma.$transaction([
      prisma.shift.update({ where: { id: shift.id }, data: { varianceCents: newVariance } }),
      prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: "shift.variance_recomputed_for_expenses",
          entityType: "Shift",
          entityId: shift.id,
          oldValues: { varianceCents: oldVariance },
          newValues: { varianceCents: newVariance, cashExpensesCents: expensesCents },
        },
      }),
    ]);
  }
  console.log(`${changed} shift(s) ${apply ? "updated" : "would change — rerun with --apply"}.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
