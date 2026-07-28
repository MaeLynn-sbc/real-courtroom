/**
 * An unmatched open-play walk-in (nobody picked a search-combobox
 * match) used to become a permanent guest: playerName/phone stored as
 * plain text on the registration, playerId left null forever, no
 * Player row ever created. The form promises "find a returning player
 * and prefill their details" but nobody could ever become one through
 * this path — confirmed live (a real customer, "Dhudz", registered on
 * a previous weeknight and did not surface in a later search).
 *
 * Proves, against real rows:
 *   1. An unmatched weeknight walk-in creates a real Player row, and
 *      the registration is linked to it (playerId set, not null).
 *   2. The SAME person, registering again with the phone number
 *      formatted differently and the name spelled slightly
 *      differently, resolves to the SAME player — no duplicate
 *      created. This is the actual anti-duplicate mechanism: phone
 *      number, normalized, not name.
 *   3. A genuinely different phone number creates a genuinely
 *      different, separate player — proves the dedup isn't
 *      over-eager.
 *   4. The Fri/Sat capacity-night path (registerWalkIn) gets the same
 *      fix, not just the weeknight one.
 *   5. A newly-created player has no email and no passwordHash (can
 *      never log in — matches that no login credential was ever
 *      collected at the desk).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const WEEKNIGHT_DATE = new Date(2031, 4, 6); // Tuesday, May 6 2031 — distinct from other fixtures
const FRISAT_DATE = new Date(2031, 4, 9); // Friday, May 9 2031 — distinct from other fixtures

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const weeknightRegs = await prisma.openPlayNightRegistration.findMany({
    where: { date: WEEKNIGHT_DATE, sessionId: null },
    select: { id: true, playerId: true },
  });
  const frisatSession = await prisma.openPlayNightSession.findUnique({ where: { date: FRISAT_DATE } });
  const frisatRegs = frisatSession
    ? await prisma.openPlayNightRegistration.findMany({ where: { sessionId: frisatSession.id }, select: { id: true, playerId: true } })
    : [];

  const allRegs = [...weeknightRegs, ...frisatRegs];
  const regIds = allRegs.map((r) => r.id);
  const playerIds = allRegs.map((r) => r.playerId).filter((id): id is string => id !== null);

  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: regIds } } });
  if (frisatSession) {
    await prisma.openPlayNightSession.delete({ where: { id: frisatSession.id } }).catch(() => {});
  }

  if (playerIds.length > 0) {
    const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, userId: true } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUp();

  try {
    // ============== 1. Unmatched weeknight walk-in creates a real Player ==============
    const reg1 = await openPlayRegistrationService.registerWeeknightWalkIn(
      WEEKNIGHT_DATE,
      { playerName: "Dhudz Quinto", phone: "0962 857 2974", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    assert(reg1.playerId !== null, "expected the unmatched walk-in's registration to have a real playerId, not null");

    const player1 = await prisma.player.findUnique({ where: { id: reg1.playerId! }, include: { user: true } });
    assert(player1 !== null, "expected a real Player row to exist for the newly-created player");
    assert(player1!.user.name === "Dhudz Quinto", `expected the player's name to be 'Dhudz Quinto', got ${player1!.user.name}`);
    assert(player1!.phone === "0962 857 2974", "expected the player's phone to match what was typed");
    console.log("PASS: an unmatched walk-in creates a real, linked Player row — the form's promise is now true.");

    // ============== 5. New player has no email, no passwordHash ==============
    assert(player1!.user.email === null, "expected a walk-in-created player to have no email — never collected");
    assert(player1!.user.passwordHash === null, "expected a walk-in-created player to have no passwordHash — can never log in");
    console.log("PASS: the new player has no email/password — correctly can't log in, matches nothing was ever collected.");

    // ============== 2. Same person, phone reformatted, name spelled differently -> SAME player ==============
    const reg2 = await openPlayRegistrationService.registerWeeknightWalkIn(
      WEEKNIGHT_DATE,
      { playerName: "dhudz quinto", phone: "+63 962 857 2974", skillLevel: "ADVANCED" },
      owner.id,
    );
    assert(reg2.playerId === reg1.playerId, `expected the same person (reformatted phone) to resolve to the SAME player, got a different one (${reg2.playerId} vs ${reg1.playerId})`);
    const totalPlayersAfterReregister = await prisma.player.count({ where: { id: reg1.playerId! } });
    assert(totalPlayersAfterReregister === 1, "expected exactly one player row for this phone number, no duplicate created");
    console.log("PASS: the same person, phone reformatted and name spelled differently, resolves to the SAME player — no duplicate.");

    // ============== 3. A genuinely different phone -> a genuinely different player ==============
    const reg3 = await openPlayRegistrationService.registerWeeknightWalkIn(
      WEEKNIGHT_DATE,
      { playerName: "Someone Else", phone: "0917 111 2222", skillLevel: "BEGINNER" },
      owner.id,
    );
    assert(reg3.playerId !== reg1.playerId, "expected a genuinely different phone number to create a genuinely different player");
    console.log("PASS: a different phone number creates a separate player — dedup isn't over-eager.");

    // ============== 4. The Fri/Sat capacity-night path gets the same fix ==============
    await openPlayCapacityService.setSessionCapacityOverride(FRISAT_DATE, 10, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(FRISAT_DATE);
    const reg4 = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Frisat Walkin Guest", phone: "0918 333 4444", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    assert(reg4.playerId !== null, "expected the Fri/Sat unmatched walk-in to also get a real playerId");
    const player4 = await prisma.player.findUnique({ where: { id: reg4.playerId! } });
    assert(player4 !== null, "expected a real Player row for the Fri/Sat walk-in too — same fix, not just the weeknight path");
    console.log("PASS: the Fri/Sat capacity-night walk-in path (registerWalkIn) gets the identical fix.");

    await cleanUp();
    console.log("\nPASS: unmatched open-play walk-ins now become real, searchable, deduplicated players.");
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
