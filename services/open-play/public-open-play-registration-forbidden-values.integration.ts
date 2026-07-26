/**
 * Open-play online self-registration, Gate 2 — the load-bearing test.
 * Not a test that omits `source` from the request; a test that SENDS a
 * forbidden override and proves the server ignores it, on the public
 * path specifically. Same shape as
 * services/coaching/public-coach-session-forbidden-values.integration.ts
 * and services/booking's own public-path proofs.
 *
 * PublicOpenPlayRegistrationInput types playerName/phone/skillLevel/date
 * only — there is no TypeScript-legal way to pass `source` to
 * createPublicOpenPlayRegistration. A hand-crafted HTTP request isn't
 * bound by that type, so this test bypasses it too (`as unknown as
 * PublicOpenPlayRegistrationInput`), constructing exactly what a raw
 * request body would produce: the real fields PLUS source: "WALK_IN"
 * riding along.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";
import type { PublicOpenPlayRegistrationInput } from "@/features/open-play-capacity/schemas/public-open-play-registration.schema";

const TEST_DATE = new Date(2031, 1, 21); // Friday, Feb 21 2031

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
    console.log("Both gates enabled for this test.");

    // Deliberately sending a forbidden value — this is what a hand-
    // crafted request body would look like. Cast bypasses the type
    // system exactly the way an attacker's raw JSON would bypass it at
    // runtime.
    const forbiddenInput = {
      playerName: "Forbidden Guest",
      phone: "09171112222",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
      source: "WALK_IN",
    } as unknown as PublicOpenPlayRegistrationInput;

    const result = await createPublicOpenPlayRegistration(forbiddenInput);
    console.log("SENT: { ...real fields, source: 'WALK_IN' } on the public registration path.");
    console.log(`RESULT: status=${result.status}`);
    assert(result.status === "registered", `expected the slot to be available and the hold to be created, got status=${result.status}`);

    const registration = await prisma.openPlayNightRegistration.findUniqueOrThrow({
      where: { id: result.registrationId },
    });
    assert(
      registration.source === "WEBSITE",
      `expected source to be forced WEBSITE regardless of the sent value, got ${registration.source}`,
    );
    assert(registration.status === "AWAITING_PAYMENT", `expected AWAITING_PAYMENT, got ${registration.status}`);
    console.log(`VERIFIED: stored row has source=${registration.source} (sent 'WALK_IN') — ignored.`);

    await cleanUpTestSession();
    console.log("PASS: public path hardcodes source=WEBSITE, proven by SENDING a forbidden value, not omitting it.");
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(false, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to OFF (verified: ${restored === false}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
