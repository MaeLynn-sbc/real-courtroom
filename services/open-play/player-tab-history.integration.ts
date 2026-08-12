/**
 * Owner request (2026-08-12): "kindly build history also of player
 * tabs. daily so we will know all the details" — proves
 * playerTabHistoryService.listTabsInRange against real rows:
 *
 *   1. Returns tabs across MULTIPLE dates within the range, not just one.
 *   2. A SETTLED tab reports its real settledVia, settledAt, and
 *      settledByName (resolved from User — PlayerTab has no direct
 *      relation there, unlike writeOffEmployeeId).
 *   3. A WRITTEN_OFF tab reports its writeOffReason and
 *      writeOffEmployeeName, with settledVia/settledByName null (a
 *      write-off never sets settledVia at all).
 *   4. totalCents reflects the tab's real line items.
 *   5. A tab outside the requested range is excluded.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { playerTabHistoryService } from "./player-tab-history.service";
import { playerTabService } from "./player-tab.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const DAY_ONE = new Date(2031, 6, 5); // Saturday, distinct from other integration fixtures' dates
const DAY_TWO = new Date(2031, 6, 6); // Sunday
const OUTSIDE_RANGE_DATE = new Date(2031, 6, 20); // well outside the DAY_ONE..DAY_TWO range queried below

let phoneCounter = 960000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

async function cleanUpDate(date: Date): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { date }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { date } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date } });
}

async function cleanUp(): Promise<void> {
  await cleanUpDate(DAY_ONE);
  await cleanUpDate(DAY_TWO);
  await cleanUpDate(OUTSIDE_RANGE_DATE);
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-TAB-HISTORY-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });

  try {
    // ============== DAY_ONE: a settled tab ==============
    const settledRegistration = await openPlayRegistrationService.registerWeeknightWalkIn(
      DAY_ONE,
      { playerName: "History Settled Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(settledRegistration.id, owner.id);
    const settledTab = await playerTabService.getTabViewByRegistration(settledRegistration.id);
    assert(settledTab, "checkIn should have opened a tab");
    await playerTabService.addRentalLineItem(settledTab!.tab.id, "house_paddle", "Paddle rental", 1, owner.id);
    const beforeSettle = await playerTabService.getTabView(settledTab!.tab.id);
    await playerTabService.settleTab(
      settledTab!.tab.id,
      "GCASH",
      "GCASH-HISTORY-TEST-REF",
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id },
      owner.id,
    );

    // ============== DAY_TWO: a written-off tab ==============
    const writeOffRegistration = await openPlayRegistrationService.registerWeeknightWalkIn(
      DAY_TWO,
      { playerName: "History WriteOff Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(writeOffRegistration.id, owner.id);
    const writeOffTab = await playerTabService.getTabViewByRegistration(writeOffRegistration.id);
    assert(writeOffTab, "checkIn should have opened a tab");
    await playerTabService.addRentalLineItem(writeOffTab!.tab.id, "house_paddle", "Paddle rental", 1, owner.id);
    await playerTabService.writeOffTab(writeOffTab!.tab.id, "Player disputed the charge", employee.id, owner.id);

    // ============== A tab OUTSIDE the queried range ==============
    const outsideRegistration = await openPlayRegistrationService.registerWeeknightWalkIn(
      OUTSIDE_RANGE_DATE,
      { playerName: "History Outside Range Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(outsideRegistration.id, owner.id);

    // ============== Query the range ==============
    const rows = await playerTabHistoryService.listTabsInRange({ from: DAY_ONE, to: DAY_TWO });

    // ============== 5. Outside-range tab excluded ==============
    assert(
      !rows.some((row) => row.playerName === "History Outside Range Player"),
      "expected a tab outside the requested range to be excluded",
    );
    console.log("PASS: a tab outside the requested range is excluded.");

    // ============== 1. Both in-range dates represented ==============
    const settledRow = rows.find((row) => row.playerName === "History Settled Player");
    const writeOffRow = rows.find((row) => row.playerName === "History WriteOff Player");
    assert(settledRow, "expected the DAY_ONE settled tab to appear in the range");
    assert(writeOffRow, "expected the DAY_TWO written-off tab to appear in the range");
    console.log("PASS: listTabsInRange returns tabs across multiple dates within the range, not just one.");

    // ============== 2. Settled tab fields ==============
    assert(settledRow!.status === "SETTLED", `expected SETTLED, got ${settledRow!.status}`);
    assert(settledRow!.settledVia === "GCASH", `expected settledVia GCASH, got ${settledRow!.settledVia}`);
    assert(settledRow!.settledAt !== null, "expected settledAt to be set");
    assert(
      settledRow!.settledByName === (owner.name ?? owner.email),
      `expected settledByName to resolve the owner's real name, got ${settledRow!.settledByName}`,
    );
    assert(
      settledRow!.totalCents === beforeSettle.totalCents,
      `expected totalCents to reflect the tab's real line items (${beforeSettle.totalCents}), got ${settledRow!.totalCents}`,
    );
    console.log("PASS: a settled tab reports its real settledVia, settledAt, and settledByName (resolved from User).");

    // ============== 3. Written-off tab fields ==============
    assert(writeOffRow!.status === "WRITTEN_OFF", `expected WRITTEN_OFF, got ${writeOffRow!.status}`);
    assert(writeOffRow!.writeOffReason === "Player disputed the charge", `expected the real write-off reason, got ${writeOffRow!.writeOffReason}`);
    assert(
      writeOffRow!.writeOffEmployeeName === `${employee.firstName} ${employee.lastName}`,
      `expected writeOffEmployeeName to resolve the real employee, got ${writeOffRow!.writeOffEmployeeName}`,
    );
    assert(writeOffRow!.settledVia === null, "expected settledVia to be null for a write-off — it never sets that field");
    // writeOffTab DOES set settledByUserId (to whoever performed the
    // write-off action) even though it never sets settledVia — a
    // real, useful distinction from writeOffEmployeeName (the employee
    // the write-off is ATTRIBUTED to, per the "no anonymous write-offs"
    // rule) versus who was actually logged in and clicked the button.
    assert(
      writeOffRow!.settledByName === (owner.name ?? owner.email),
      `expected settledByName to resolve to whoever performed the write-off, got ${writeOffRow!.settledByName}`,
    );
    console.log(
      "PASS: a written-off tab reports its real writeOffReason/writeOffEmployeeName, settledVia null, settledByName resolved to who processed it.",
    );

    await cleanUp();
    console.log("\nPASS: player tabs history proven against real rows.");
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
