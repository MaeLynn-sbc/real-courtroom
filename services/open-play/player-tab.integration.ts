/**
 * BUILD-SPEC.md §9's required correctness tests, run against real Postgres:
 *
 *   1. "3 games + 1 paddle == ₱125" (3 x ₱35 + ₱20).
 *   2. "A voided game reduces the tab."
 *   3. "A Fri/Sat player with 6 games owes ₱0" (games billed at ₱0 there).
 *   4. "Closing a session with an open tab is blocked."
 *
 * Plus review-round follow-ups: settlement creates a Sale through the
 * standard Employee+Shift path; settling or writing off the same tab
 * twice is rejected, not duplicated; write-offs require a real employee
 * and are visible separately from revenue; a rental line item snapshots
 * its amount (repricing equipment doesn't rewrite an existing tab); and
 * voiding a game credit then re-crediting the same assignment succeeds
 * rather than silently no-op'ing (a free game with no error).
 *
 * Run via `npm run test:integration` (see run-integration-tests.ts). Uses
 * weeknight registrations for tests 1/2 (tab keys off `date`, no session
 * needed) and a real Fri/Sat session for tests 3/4.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlaySalesService } from "./open-play-sales.service";
import { playerTabService } from "./player-tab.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const WEEKNIGHT_DATE = new Date(2031, 0, 22); // Wednesday
const WRITE_OFF_VISIBILITY_DATE = new Date(2031, 0, 27); // Monday — isolated so the aggregate sales-summary assertion isn't polluted by other write-off tests sharing WEEKNIGHT_DATE

let phoneCounter = 950000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

// Creates a real, DONE GameAssignment (satisfying TabLineItem's FK) with
// exactly one participant, then credits it to that player's tab — the
// same call rotation.service.ts's completeAssignment makes, exercised
// directly here instead of running a full 4-player propose/confirm/
// complete cycle for every credited game.
async function creditGameDirectly(registrationId: string, courtId: string, date: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.gameAssignment.create({
      data: { courtId, date, skillSpread: 0, source: "AUTO", status: "DONE", startedAt: new Date(), endedAt: new Date() },
    });
    await tx.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId } });
    await playerTabService.creditGame(registrationId, assignment.id, tx);
  });
}

async function cleanUpDate(date: Date): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date } });
  await prisma.queueEntry.deleteMany({ where: { date } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date } });
}

async function cleanUpWeeknight(): Promise<void> {
  await cleanUpDate(WEEKNIGHT_DATE);
  await cleanUpDate(WRITE_OFF_VISIBILITY_DATE);
}

async function cleanUpFridaySession(friday: Date): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: friday } });
  if (!session) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { sessionId: session.id },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { sessionId: session.id } });
  await prisma.queueEntry.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightSession.delete({ where: { id: session.id } });
}

async function testThreeGamesPlusOnePaddle(courtId: string, actorUserId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Tab Test Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);

  const tabBefore = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tabBefore, "checkIn should have opened a tab");
  assert(tabBefore!.tab.gameRateCents === 3500, `expected weeknight gameRateCents 3500, got ${tabBefore!.tab.gameRateCents}`);

  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  await playerTabService.addRentalLineItem(tabBefore!.tab.id, "house_paddle", "Paddle rental", 1, actorUserId);

  const view = await playerTabService.getTabView(tabBefore!.tab.id);
  assert(view.gamesPlayed === 3, `expected 3 games played, got ${view.gamesPlayed}`);
  assert(view.totalCents === 12500, `expected ₱125.00 (12500 centavos), got ${view.totalCents}`);

  console.log("PASS: 3 games + 1 paddle == ₱125.00");
}

async function testVoidedGameReducesTab(courtId: string, actorUserId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Void Test Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  const afterCredit = await playerTabService.getTabView(tab!.tab.id);
  assert(afterCredit.totalCents === 3500, `expected ₱35 after one game, got ${afterCredit.totalCents}`);

  const gameLineItem = afterCredit.lineItems.find((li) => li.type === "GAME");
  assert(gameLineItem, "expected a GAME line item to void");
  await playerTabService.voidLineItem(tab!.tab.id, gameLineItem!.id, "Mis-credited — court was actually idle", actorUserId);

  const afterVoid = await playerTabService.getTabView(tab!.tab.id);
  assert(afterVoid.totalCents === 0, `expected ₱0 after voiding the only charge, got ${afterVoid.totalCents}`);

  console.log("PASS: a voided game reduces the tab");
}

async function testFriSatPlayerOwesZero(courtId: string, actorUserId: string): Promise<void> {
  const upcoming = await openPlayCapacityService.getUpcomingNights(14);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 14 days");
  await cleanUpFridaySession(friday!);

  const session = await openPlayCapacityService.getOrCreateSessionForDate(friday!);
  const registration = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Fri Sat Tab Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);

  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  assert(tab!.tab.gameRateCents === 0, `expected Fri/Sat gameRateCents 0, got ${tab!.tab.gameRateCents}`);

  for (let i = 0; i < 6; i++) {
    await creditGameDirectly(registration.id, courtId, session.date);
  }

  const view = await playerTabService.getTabView(tab!.tab.id);
  assert(view.gamesPlayed === 6, `expected 6 games played, got ${view.gamesPlayed}`);
  assert(view.totalCents === 0, `expected ₱0 owed for 6 Fri/Sat games, got ${view.totalCents}`);

  console.log("PASS: a Fri/Sat player with 6 games owes ₱0");

  await cleanUpFridaySession(friday!);
}

async function testClosingSessionBlockedByOpenTab(courtId: string, actorUserId: string): Promise<void> {
  const upcoming = await openPlayCapacityService.getUpcomingNights(14);
  const saturday = upcoming.find((n) => n.dayOfWeek === 6)?.date;
  assert(saturday, "expected an upcoming Saturday within 14 days");
  await cleanUpFridaySession(saturday!); // same cleanup logic, keyed by date

  const session = await openPlayCapacityService.getOrCreateSessionForDate(saturday!);
  const registration = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Close Guard Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  // Fri/Sat games bill ₱0, so credit a rental instead to give this tab a
  // real non-zero open balance — the case the guard cares about.
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  await playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", "Paddle rental", 1, actorUserId);

  let threw = false;
  try {
    await openPlayCapacityService.closeSession(session.id, actorUserId);
  } catch {
    threw = true;
  }
  assert(threw, "closing a session with an open, non-zero tab must be blocked");

  const sessionAfter = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { id: session.id } });
  assert(sessionAfter.status === "OPEN", "session must remain OPEN when close is blocked");

  console.log("PASS: closing a session with an open tab is blocked");

  await cleanUpFridaySession(saturday!);
}

async function testSettlementCreatesASale(courtId: string, actorUserId: string, employeeId: string, shiftId: string, paymentMethodId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Settle Test Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);

  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  const settled = await playerTabService.settleTab(
    tab!.tab.id,
    "CASH",
    null,
    { employeeId, shiftId, paymentMethodId },
    actorUserId,
  );
  assert(settled.status === "SETTLED", "tab should be SETTLED after settlement");

  const sale = await prisma.sale.findFirst({ where: { playerTabId: tab!.tab.id } });
  assert(sale, "settling a non-zero tab should create a Sale row");
  assert(sale!.amountCents === 3500, `expected Sale amountCents 3500, got ${sale!.amountCents}`);
  assert(sale!.category === "OPEN_PLAY", `expected category OPEN_PLAY, got ${sale!.category}`);

  console.log("PASS: settling a tab creates a Sale row through the standard Employee+Shift-backed path");
}

// Review follow-up #2: "settle the same tab twice — exactly one Sale row,
// second call rejected." The button isn't the only caller, so this calls
// settleTab twice directly, simulating a duplicate/concurrent request.
async function testSettlingTwiceIsRejectedNotDuplicated(
  courtId: string,
  actorUserId: string,
  employeeId: string,
  shiftId: string,
  paymentMethodId: string,
): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Double Settle Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  await playerTabService.settleTab(tab!.tab.id, "CASH", null, { employeeId, shiftId, paymentMethodId }, actorUserId);

  let secondCallThrew = false;
  try {
    await playerTabService.settleTab(tab!.tab.id, "CASH", null, { employeeId, shiftId, paymentMethodId }, actorUserId);
  } catch {
    secondCallThrew = true;
  }
  assert(secondCallThrew, "settling an already-settled tab a second time must be rejected, not silently repeated");

  const sales = await prisma.sale.findMany({ where: { playerTabId: tab!.tab.id } });
  assert(sales.length === 1, `expected exactly 1 Sale row after settling twice, got ${sales.length}`);

  console.log("PASS: settling the same tab twice yields exactly one Sale row — the second call is rejected");
}

// Review follow-up #2 (write-off half): same idempotency requirement for
// writeOffTab.
async function testWriteOffTwiceIsRejected(courtId: string, actorUserId: string, employeeId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Double WriteOff Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  await playerTabService.writeOffTab(tab!.tab.id, "Player disputed the charge", employeeId, actorUserId);

  let secondCallThrew = false;
  try {
    await playerTabService.writeOffTab(tab!.tab.id, "Retried write-off", employeeId, actorUserId);
  } catch {
    secondCallThrew = true;
  }
  assert(secondCallThrew, "writing off an already-written-off tab a second time must be rejected");

  console.log("PASS: writing off the same tab twice is rejected, not silently repeated");
}

// Review follow-up #3: "no anonymous write-offs" + visibility on the sales
// summary, separate from revenue.
async function testWriteOffRequiresEmployeeAndIsVisibleSeparately(courtId: string, actorUserId: string, employeeId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WRITE_OFF_VISIBILITY_DATE,
    { playerName: "Attributed WriteOff Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WRITE_OFF_VISIBILITY_DATE);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  let missingEmployeeThrew = false;
  try {
    await playerTabService.writeOffTab(tab!.tab.id, "No employee provided", "", actorUserId);
  } catch {
    missingEmployeeThrew = true;
  }
  assert(missingEmployeeThrew, "writeOffTab must reject a missing employeeId — no anonymous write-offs");

  let missingReasonThrew = false;
  try {
    await playerTabService.writeOffTab(tab!.tab.id, "   ", employeeId, actorUserId);
  } catch {
    missingReasonThrew = true;
  }
  assert(missingReasonThrew, "writeOffTab must reject a blank reason");

  const REASON = "Player never returned";
  const written = await playerTabService.writeOffTab(tab!.tab.id, REASON, employeeId, actorUserId);
  assert(written.writeOffEmployeeId === employeeId, "the write-off must record which employee attributed it");
  assert(written.writeOffReason === REASON, "the write-off must record the reason");

  const summary = await openPlaySalesService.getSummary(WRITE_OFF_VISIBILITY_DATE, WRITE_OFF_VISIBILITY_DATE);
  assert(summary.writeOffCents === 3500, `expected write-off total to include this ₱35 tab, got ${summary.writeOffCents}`);
  assert(summary.writeOffCount >= 1, "expected at least 1 written-off tab counted");
  assert(
    summary.perGameRevenueCents === 0,
    `a written-off tab's game charge must not appear in net revenue — got ${summary.perGameRevenueCents}`,
  );

  const detail = summary.writeOffs.find((w) => w.tabId === tab!.tab.id);
  assert(detail, "the write-off summary must include a per-tab detail entry, not just an aggregate");
  assert(detail!.reason === REASON, `expected the summary detail's reason to be "${REASON}", got "${detail!.reason}"`);
  assert(
    detail!.employeeName.length > 0 && detail!.employeeName !== "Unknown",
    `expected the summary detail's employeeName to be resolved, got "${detail!.employeeName}"`,
  );

  console.log(
    "PASS: write-offs require an employee and a reason, and both are visible in the sales summary detail — separate from revenue",
  );
}

// Review follow-up #5: confirm rental line items snapshot their amount at
// creation — changing the Equipment price afterward must not silently
// rewrite an already-settled tab's total.
async function testRentalLineItemSnapshotsAmount(courtId: string, actorUserId: string): Promise<void> {
  void courtId;
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Paddle Price Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  const paddle = await prisma.equipment.findUniqueOrThrow({ where: { key: "house_paddle" } });
  const originalRateCents = paddle.rentalRateCents;

  try {
    await playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", "Paddle rental", 1, actorUserId);
    const beforePriceChange = await playerTabService.getTabView(tab!.tab.id);
    assert(beforePriceChange.totalCents === originalRateCents, "tab should reflect the paddle's price at the time it was added");

    // Reprice the paddle after the fact — a real operational change, not a
    // test artifact.
    await prisma.equipment.update({ where: { id: paddle.id }, data: { rentalRateCents: originalRateCents + 5000 } });

    const afterPriceChange = await playerTabService.getTabView(tab!.tab.id);
    assert(
      afterPriceChange.totalCents === originalRateCents,
      `repricing equipment must not rewrite an already-added line item — expected ${originalRateCents}, got ${afterPriceChange.totalCents}`,
    );

    console.log("PASS: a rental line item snapshots its amount at creation — repricing equipment doesn't rewrite it");
  } finally {
    await prisma.equipment.update({ where: { id: paddle.id }, data: { rentalRateCents: originalRateCents } });
  }
}

// Review follow-up #6: void a game credit, then credit the *same*
// gameAssignmentId again (the only way this could legitimately recur —
// completeAssignment can't re-run for an already-DONE assignment, but
// creditGame's own contract must still be correct in isolation, since it
// isn't only ever called from there). Must succeed, not silently no-op.
async function testVoidThenRecreditSameAssignment(courtId: string, actorUserId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Void Recredit Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");

  const assignment = await prisma.gameAssignment.create({
    data: { courtId, date: WEEKNIGHT_DATE, skillSpread: 0, source: "AUTO", status: "DONE", startedAt: new Date(), endedAt: new Date() },
  });
  await prisma.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId: registration.id } });

  await prisma.$transaction((tx) => playerTabService.creditGame(registration.id, assignment.id, tx));
  const afterFirstCredit = await playerTabService.getTabView(tab!.tab.id);
  assert(afterFirstCredit.totalCents === 3500, `expected ₱35 after first credit, got ${afterFirstCredit.totalCents}`);

  const gameLineItem = afterFirstCredit.lineItems.find((li) => li.type === "GAME" && li.gameAssignmentId === assignment.id);
  assert(gameLineItem, "expected a GAME line item for this assignment");
  await playerTabService.voidLineItem(tab!.tab.id, gameLineItem!.id, "Mis-credited, correcting", actorUserId);
  const afterVoid = await playerTabService.getTabView(tab!.tab.id);
  assert(afterVoid.totalCents === 0, `expected ₱0 after voiding, got ${afterVoid.totalCents}`);

  // Re-credit the exact same assignment — must succeed, not silently no-op.
  await prisma.$transaction((tx) => playerTabService.creditGame(registration.id, assignment.id, tx));
  const afterRecredit = await playerTabService.getTabView(tab!.tab.id);
  assert(
    afterRecredit.totalCents === 3500,
    `re-crediting the same assignment after voiding must succeed — expected ₱35, got ${afterRecredit.totalCents}. ` +
      `If this is 0, creditGame's idempotency check is treating the voided row as still-active and silently skipping the recredit.`,
  );

  console.log("PASS: voiding a game credit and re-crediting the same assignment succeeds — no silent free game");
}

// Owner request (2026-08-12): "the regular open play should separate
// the add ons for the balls and other products. it shouldnt be in the
// regular open play sales" — proves settleTab now creates ONE Sale for
// the game charge (category OPEN_PLAY) plus a SEPARATE Sale per product
// add-on (category PRODUCT, productId set), mirroring
// bookingTabService.settleTab exactly, instead of folding everything
// into one lump OPEN_PLAY sale.
async function testSettlementSplitsProductAddOnIntoSeparateSale(
  courtId: string,
  actorUserId: string,
  employeeId: string,
  shiftId: string,
  paymentMethodId: string,
): Promise<void> {
  const product = await prisma.product.findFirstOrThrow({ where: { active: true } });

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Product Split Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);

  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  await playerTabService.addProductLineItem(tab!.tab.id, product.id, 2, actorUserId);

  const beforeSettle = await playerTabService.getTabView(tab!.tab.id);
  const expectedProductCents = product.priceCents * 2;
  assert(
    beforeSettle.totalCents === 3500 + expectedProductCents,
    `expected tab total to be the game charge plus the product (${3500 + expectedProductCents}), got ${beforeSettle.totalCents}`,
  );

  await playerTabService.settleTab(tab!.tab.id, "CASH", null, { employeeId, shiftId, paymentMethodId }, actorUserId);

  const sales = await prisma.sale.findMany({ where: { playerTabId: tab!.tab.id } });
  assert(sales.length === 2, `expected exactly 2 Sale rows (one OPEN_PLAY, one PRODUCT), got ${sales.length}`);

  const openPlaySale = sales.find((s) => s.category === "OPEN_PLAY");
  assert(openPlaySale, "expected one Sale with category OPEN_PLAY");
  assert(openPlaySale!.amountCents === 3500, `expected the OPEN_PLAY sale to be exactly the game charge (3500), got ${openPlaySale!.amountCents}`);
  assert(openPlaySale!.productId === null, "expected the OPEN_PLAY sale to have no productId");

  const productSale = sales.find((s) => s.category === "PRODUCT");
  assert(productSale, "expected one Sale with category PRODUCT");
  assert(
    productSale!.amountCents === expectedProductCents,
    `expected the PRODUCT sale to be exactly the add-on charge (${expectedProductCents}), got ${productSale!.amountCents}`,
  );
  assert(productSale!.productId === product.id, "expected the PRODUCT sale's productId to trace back to the real Product row");

  console.log("PASS: settling a tab with a product add-on creates two Sales — OPEN_PLAY for the game charge, PRODUCT for the add-on, not one lump sale");
}

// Same scenario, but the product add-on is voided before settlement —
// proves it's excluded outright (no stray PRODUCT sale, and no leaked
// negative charge landing in the OPEN_PLAY sale either, since the
// compensating void row is type ADJUSTMENT, not PRODUCT).
async function testVoidedProductAddOnExcludedFromBothSales(
  courtId: string,
  actorUserId: string,
  employeeId: string,
  shiftId: string,
  paymentMethodId: string,
): Promise<void> {
  const product = await prisma.product.findFirstOrThrow({ where: { active: true } });

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Voided Product Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  await creditGameDirectly(registration.id, courtId, WEEKNIGHT_DATE);

  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  const productItem = await playerTabService.addProductLineItem(tab!.tab.id, product.id, 1, actorUserId);
  await playerTabService.voidLineItem(tab!.tab.id, productItem.id, "Player changed their mind", actorUserId);

  const beforeSettle = await playerTabService.getTabView(tab!.tab.id);
  assert(beforeSettle.totalCents === 3500, `expected the voided product to be fully excluded, tab total should be just the game charge (3500), got ${beforeSettle.totalCents}`);

  await playerTabService.settleTab(tab!.tab.id, "CASH", null, { employeeId, shiftId, paymentMethodId }, actorUserId);

  const sales = await prisma.sale.findMany({ where: { playerTabId: tab!.tab.id } });
  assert(sales.length === 1, `expected exactly 1 Sale row (the voided product creates none), got ${sales.length}`);
  assert(sales[0]!.category === "OPEN_PLAY", `expected the one Sale to be OPEN_PLAY, got ${sales[0]!.category}`);
  assert(
    sales[0]!.amountCents === 3500,
    `expected the OPEN_PLAY sale to be exactly the game charge (3500), with no leaked negative from the voided product's compensating entry, got ${sales[0]!.amountCents}`,
  );

  console.log("PASS: a voided product add-on creates no PRODUCT sale and leaves the OPEN_PLAY sale unaffected — no leaked negative charge.");
}

async function main() {
  await cleanUpWeeknight();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    const sequence = Date.now();
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-TEST-${sequence}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });

  try {
    await testThreeGamesPlusOnePaddle(court.id, owner.id);
    await testVoidedGameReducesTab(court.id, owner.id);
    await testFriSatPlayerOwesZero(court.id, owner.id);
    await testClosingSessionBlockedByOpenTab(court.id, owner.id);
    await testSettlementCreatesASale(court.id, owner.id, employee.id, shift.id, paymentMethod.id);
    await testSettlementSplitsProductAddOnIntoSeparateSale(court.id, owner.id, employee.id, shift.id, paymentMethod.id);
    await testVoidedProductAddOnExcludedFromBothSales(court.id, owner.id, employee.id, shift.id, paymentMethod.id);
    await testSettlingTwiceIsRejectedNotDuplicated(court.id, owner.id, employee.id, shift.id, paymentMethod.id);
    await testWriteOffTwiceIsRejected(court.id, owner.id, employee.id);
    await testWriteOffRequiresEmployeeAndIsVisibleSeparately(court.id, owner.id, employee.id);
    await testRentalLineItemSnapshotsAmount(court.id, owner.id);
    await testVoidThenRecreditSameAssignment(court.id, owner.id);
  } finally {
    await cleanUpWeeknight();
  }

  console.log("\nAll player tab / settlement scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUpWeeknight();
  process.exit(1);
});
