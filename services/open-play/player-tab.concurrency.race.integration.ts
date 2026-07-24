/**
 * Hardening phase, fix 4/6 (BUILD-SPEC.md §0 process rule): addRentalLineItem
 * / addAdjustment / voidLineItem's tab-is-OPEN check was a plain read, not
 * atomic with settleTab's guarded update. A charge added in that window
 * could land after a racing settlement already computed its total —
 * recorded as a line item, but never billed, silently.
 *
 * Fixture: an open weeknight tab, settleTab and addRentalLineItem fired
 * concurrently at it. The corruption is a SETTLED tab that gained a line
 * item after settlement — money the recorded Sale never included.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { playerTabService } from "./player-tab.service";

const TEST_DATE = new Date(2031, 1, 13); // Thursday, distinct fixture

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { date: TEST_DATE }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { date: TEST_DATE } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: TEST_DATE } });
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-RACE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    TEST_DATE,
    { playerName: "Add-vs-Settle Race Player", phone: "09930000", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  await openPlayCheckinService.checkIn(registration.id, owner.id);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  console.log("Firing settleTab and addRentalLineItem concurrently against the same open, zero-balance tab...");
  await Promise.allSettled([
    playerTabService.settleTab(tab!.tab.id, "CASH", null, { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id }, owner.id),
    playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", "Paddle rental", 1, owner.id),
  ]);

  const finalView = await playerTabService.getTabView(tab!.tab.id);
  const sale = await prisma.sale.findUnique({ where: { playerTabId: tab!.tab.id } });
  console.log(`Final tab status: ${finalView.tab.status}, total: ${finalView.totalCents}, Sale amount: ${sale?.amountCents ?? "none"}`);

  if (finalView.tab.status === "SETTLED") {
    const saleAmount = sale?.amountCents ?? 0;
    assert(
      saleAmount === finalView.totalCents,
      `a SETTLED tab's Sale amount must equal its final total — Sale recorded ₱${(saleAmount / 100).toFixed(2)}, ` +
        `tab total is ₱${(finalView.totalCents / 100).toFixed(2)}. A mismatch means a charge landed after settlement computed its total — silently unbilled.`,
    );
  }

  await cleanUp();
  console.log("PASS — a charge never lands on a tab after settlement without being reflected in the settled amount.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => undefined);
  process.exit(1);
});
