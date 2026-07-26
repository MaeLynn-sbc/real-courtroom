/**
 * Open-play online self-registration, Gate 2 — the full lifecycle
 * against real rows, no shortcuts: both gates off/on, capacity-
 * available -> hold, full -> waitlist (no hold, no proof row),
 * cancellation -> invite (no walk-in waitlist head to prefer), an
 * expired invite -> terminal (no auto-return) -> passes to the next
 * person, and a multi-seat capacity raise inviting more than one
 * person in FCFS order.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 1, 7); // Friday, Feb 7 2031

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (existing) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUpTestSession();

  try {
    // ============== BOTH GATES OFF (the real default) ==============
    const offResult = await createPublicOpenPlayRegistration({
      playerName: "Gate Off Guest",
      phone: "09170000001",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(offResult.status === "disabled", `expected disabled with the feature-wide switch off, got ${offResult.status}`);
    console.log("PASS: feature-wide switch off -> disabled, no session/registration touched.");

    // ============== SWITCH ON, DAY TOGGLE OFF ==============
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    // Gate 2 review follow-up: this file's fixture date is years out
    // (matching every other integration test's convention of using a
    // far-future date to avoid colliding with real data) — raise the
    // lead-time window so the new registration-opens-N-days-before
    // check (proven on its own in open-play-registration-lead-time
    // .integration.ts) doesn't interfere with what this file is
    // actually testing.
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, false, owner.id);
    const dayOffResult = await createPublicOpenPlayRegistration({
      playerName: "Day Off Guest",
      phone: "09170000002",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(dayOffResult.status === "disabled", `expected disabled with Friday's own toggle off, got ${dayOffResult.status}`);
    console.log("PASS: feature-wide switch on but Friday's own toggle off -> still disabled. Both gates required.");

    // ============== BOTH GATES ON — the real test begins ==============
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 2, owner.id);
    console.log("Both gates on, capacity set to 2 for this test.");

    async function submit(playerName: string, phone: string) {
      return createPublicOpenPlayRegistration({ playerName, phone, skillLevel: "INTERMEDIATE", date: dateValue(TEST_DATE) });
    }

    const resultA = await submit("Guest A", "09170000010");
    const resultB = await submit("Guest B", "09170000011");
    assert(resultA.status === "registered", `expected A registered (hold), got ${resultA.status}`);
    assert(resultB.status === "registered", `expected B registered (hold), got ${resultB.status}`);
    console.log("PASS: first 2 submissions against capacity 2 both get a real AWAITING_PAYMENT hold.");

    const resultC = await submit("Guest C", "09170000012");
    const resultD = await submit("Guest D", "09170000013");
    assert(resultC.status === "waitlisted", `expected C waitlisted (full), got ${resultC.status}`);
    assert(resultD.status === "waitlisted", `expected D waitlisted (full), got ${resultD.status}`);
    if (resultC.status !== "waitlisted" || resultD.status !== "waitlisted") throw new Error("unreachable");
    const noRegForC = await prisma.openPlayNightRegistration.findFirst({ where: { phone: "09170000012" } });
    assert(noRegForC === null, "expected NO OpenPlayNightRegistration row for a waitlisted submission — no hold, no proof row");
    console.log("PASS: once full, submission goes straight to OpenPlayWaitlistEntry — no hold, no registration row at all.");

    // ============== CANCELLATION -> INVITE (no walk-in waitlist head) ==============
    if (resultA.status !== "registered") throw new Error("unreachable");
    await openPlayRegistrationService.cancelRegistration(resultA.registrationId, owner.id);

    const cAfterInvite = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: resultC.waitlistEntryId } });
    assert(cAfterInvite.status === "INVITED", `expected C invited after A's slot freed, got ${cAfterInvite.status}`);
    assert(cAfterInvite.registrationId !== null, "expected C's invite to have created a real registration");
    const cRegistration = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: cAfterInvite.registrationId! } });
    assert(cRegistration.status === "AWAITING_PAYMENT", `expected C's new registration to be AWAITING_PAYMENT, got ${cRegistration.status}`);
    assert(cRegistration.source === "WEBSITE", `expected C's registration source WEBSITE, got ${cRegistration.source}`);
    console.log("PASS: cancelling A's hold correctly invited C (the oldest WAITING entry), creating a real hold only now.");

    const dStillWaiting = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: resultD.waitlistEntryId } });
    assert(dStillWaiting.status === "WAITING", `expected D to still be WAITING, got ${dStillWaiting.status}`);

    // ============== EXPIRED INVITE -> TERMINAL, PASSES TO NEXT ==============
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    await prisma.openPlayWaitlistEntry.update({ where: { id: cAfterInvite.id }, data: { inviteExpiresAt: past } });
    await prisma.openPlayNightRegistration.update({ where: { id: cRegistration.id }, data: { holdExpiresAt: past } });
    console.log("Backdated C's invite/hold to simulate the 30-minute window lapsing.");

    if (resultB.status !== "registered") throw new Error("unreachable");
    await openPlayRegistrationService.cancelRegistration(resultB.registrationId, owner.id);

    const cAfterExpiry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: cAfterInvite.id } });
    assert(cAfterExpiry.status === "EXPIRED", `expected C to be EXPIRED after its invite lapsed, got ${cAfterExpiry.status}`);
    const dAfterInvite = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: resultD.waitlistEntryId } });
    assert(dAfterInvite.status === "INVITED", `expected D invited next (FCFS), got ${dAfterInvite.status}`);
    assert(dAfterInvite.registrationId !== null, "expected D's invite to have created a real registration");
    console.log("PASS: C's expired invite transitioned to EXPIRED (terminal) and D was invited next — a real, testable transition.");

    // Confirmed requirement: no auto-return to WAITING. (Already proven
    // by the EXPIRED assertion above — canTransitionOpenPlayWaitlistEntryStatus
    // has no EXPIRED -> WAITING entry in its table at all, so TypeScript
    // itself now knows cAfterExpiry.status can't be "WAITING" here.)
    console.log("PASS: expired invite does not auto-return to the waitlist — confirmed terminal behavior.");

    // ============== CAPACITY RAISED — invites more than one at once ==============
    // D now occupies the seat A's cancellation freed; the OTHER seat (B's,
    // now vacated) is free again (C's expired hold no longer counts).
    // Fill it, then queue two more so a multi-seat raise has two people
    // to invite in one call.
    const resultE = await submit("Guest E", "09170000014");
    assert(resultE.status === "registered", `expected E registered (one seat still free), got ${resultE.status}`);
    const resultF = await submit("Guest F", "09170000015");
    const resultG = await submit("Guest G", "09170000016");
    assert(resultF.status === "waitlisted", `expected F waitlisted (full again), got ${resultF.status}`);
    assert(resultG.status === "waitlisted", `expected G waitlisted (full again), got ${resultG.status}`);
    if (resultF.status !== "waitlisted" || resultG.status !== "waitlisted") throw new Error("unreachable");

    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 4, owner.id);

    const fAfterRaise = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: resultF.waitlistEntryId } });
    const gAfterRaise = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: resultG.waitlistEntryId } });
    console.log(`After raising capacity 2 -> 4: F=${fAfterRaise.status}, G=${gAfterRaise.status}`);
    assert(fAfterRaise.status === "INVITED", `expected F invited by the multi-seat capacity raise, got ${fAfterRaise.status}`);
    assert(gAfterRaise.status === "INVITED", `expected G ALSO invited by the same raise (2 seats freed), got ${gAfterRaise.status}`);
    console.log("PASS: a capacity raise that frees more than one seat invites more than one waitlist entry, FCFS, in one call.");

    await cleanUpTestSession();
    console.log("\nPASS: full open-play online registration lifecycle proven against real rows.");
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(false, owner.id);
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to OFF (verified: ${restored === false}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
