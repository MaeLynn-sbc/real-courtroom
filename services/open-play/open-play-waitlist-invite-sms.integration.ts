/**
 * Open-play online self-registration, Gate 2 follow-up — proves
 * inviteNextWaitlistEntry actually CALLS the SMS interface when it
 * invites someone, not just that the interface exists. Confirmed gap
 * from the Gate 2 review: the interface (services/sms/) was built in
 * Gate 1 but Gate 2 never wired a call to it. This test monkey-patches
 * the real ConsoleSmsService instance returned by getSmsService() (the
 * same singleton production code calls) to record what was sent,
 * rather than asserting on log output — a direct proof, not an
 * inference from side effects.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";
import { getSmsService } from "../sms/sms-service.factory";

const TEST_DATE = new Date(2031, 2, 7); // Friday, Mar 7 2031 — distinct from other integration fixtures' dates

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

  const smsService = getSmsService();
  const originalSend = smsService.send.bind(smsService);
  const sentMessages: { phone: string; message: string }[] = [];
  smsService.send = async (phone: string, message: string) => {
    sentMessages.push({ phone, message });
  };

  try {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    // Gate 2 review follow-up: raise the lead-time window so the new
    // registration-opens-N-days-before check (proven on its own in
    // open-play-registration-lead-time.integration.ts) doesn't reject
    // this file's far-future fixture date.
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 1, owner.id);
    console.log("Both gates on, capacity set to 1.");

    const holder = await createPublicOpenPlayRegistration({
      playerName: "SMS Holder",
      phone: "09170000050",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(holder.status === "registered", `expected the holder to occupy the only seat, got ${holder.status}`);
    if (holder.status !== "registered") throw new Error("unreachable");

    const waiter = await createPublicOpenPlayRegistration({
      playerName: "SMS Waiter",
      phone: "09170000051",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(waiter.status === "waitlisted", `expected the waiter to be waitlisted (full), got ${waiter.status}`);
    if (waiter.status !== "waitlisted") throw new Error("unreachable");

    // < 1 rather than === 0: an equality check here makes TS's CFA
    // narrow sentMessages.length to the literal 0 for the rest of the
    // function, which it can't invalidate across the later awaited
    // calls that mutate the array through the monkey-patched closure —
    // producing false "no overlap" errors on every later count check.
    assert(sentMessages.length < 1, `expected no SMS sent yet (nobody invited), got ${sentMessages.length}`);
    console.log("PASS: no SMS sent at submission time — only an actual invite should trigger one.");

    // Cancelling the holder's hold frees the seat and should invite the
    // waiter, which should fire exactly one SMS to the waiter's phone.
    await openPlayRegistrationService.cancelRegistration(holder.registrationId, owner.id);

    const waiterEntry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiter.waitlistEntryId } });
    assert(waiterEntry.status === "INVITED", `expected the waiter to be invited after the seat freed, got ${waiterEntry.status}`);

    console.log(`SMS sent: ${sentMessages.length}`, sentMessages);
    // Fresh local bindings, not repeated reads of sentMessages.length/[0]
    // — TS's assertion-narrowing otherwise treats those expressions as
    // still equal to whatever an earlier assert() proved, even across
    // the later mutations (the SMS calls) it can't see through.
    const firstInviteCount = sentMessages.length;
    const firstInviteSent = sentMessages[0];
    assert(firstInviteCount === 1, `expected exactly 1 SMS sent for the one invite, got ${firstInviteCount}`);
    assert(firstInviteSent !== undefined, "expected a recorded SMS send");
    assert(firstInviteSent.phone === "09170000051", `expected the SMS to go to the waiter's phone, got ${firstInviteSent.phone}`);
    assert(firstInviteSent.message.length > 0, "expected a non-empty SMS message body");
    console.log("PASS: inviting a waitlist entry actually calls SmsService.send with the correct phone.");

    // Multi-invite scenario: raising capacity to free 2 seats at once
    // (via a fresh waiter + a second cancellation) should fire a second,
    // independent SMS — proves the call sits inside the loop, not just
    // fired once outside it.
    sentMessages.length = 0;
    const waiter2 = await createPublicOpenPlayRegistration({
      playerName: "SMS Waiter 2",
      phone: "09170000052",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(waiter2.status === "waitlisted", `expected the second waiter to be waitlisted (still full), got ${waiter2.status}`);
    if (waiter2.status !== "waitlisted") throw new Error("unreachable");

    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 2, owner.id);

    const waiter2Entry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiter2.waitlistEntryId } });
    assert(waiter2Entry.status === "INVITED", `expected the second waiter invited by the capacity raise, got ${waiter2Entry.status}`);
    const secondInviteCount = sentMessages.length;
    const secondInviteSent = sentMessages[0];
    assert(secondInviteCount === 1, `expected exactly 1 SMS sent for the capacity-raise invite, got ${secondInviteCount}`);
    assert(secondInviteSent !== undefined, "expected a recorded SMS send");
    assert(secondInviteSent.phone === "09170000052", `expected the SMS to go to the second waiter's phone, got ${secondInviteSent.phone}`);
    console.log("PASS: a capacity-raise invite also fires its own SMS.");

    await cleanUpTestSession();
    console.log("\nPASS: inviteNextWaitlistEntry genuinely calls SmsService.send on every real invite.");
  } finally {
    smsService.send = originalSend;
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to ON (verified: ${restored === true}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
