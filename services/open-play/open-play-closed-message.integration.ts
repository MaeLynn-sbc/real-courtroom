/**
 * Open play — per-date closed-registration message. Proves, against
 * real rows, the three behaviors explicitly asked for before commit:
 *   1. A blank/whitespace-only per-date message resolves to the global
 *      default, not an empty block.
 *   2. Clearing the per-date field (saving "") is a real two-way write —
 *      the override goes back to null, not stuck at its last value.
 *   3. The per-date message is settable independent of
 *      onlineRegistrationBlocked — before the toggle is ever flipped on,
 *      and it survives the toggle being flipped afterward (proves
 *      setOnlineRegistrationBlockedForDate's scoped update, which only
 *      names onlineRegistrationBlocked in its `data`, can't clobber a
 *      message set earlier — see that method's own comment).
 *
 * Uses a real near-future Friday (via getUpcomingNights, same
 * convention as open-play-capacity-upcoming-counts.integration.ts)
 * rather than a fixed far-future fixture date.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { resolveOpenPlayClosedMessage } from "../../lib/open-play-closed-message";
import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpDate(date: Date): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (existing) {
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const globalDefault = "Unlimited open play isn't open for online registration yet.";

  const upcoming = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 21 days");

  await cleanUpDate(friday!);

  try {
    // 1. Set the message BEFORE ever touching the block toggle — proves
    // it isn't gated on onlineRegistrationBlocked (materializes the
    // session row itself, same "one per date, created on demand"
    // pattern the toggle uses).
    const afterMessage = await openPlayCapacityService.setClosedMessageForDate(
      friday!,
      "Sold out for a private event, sorry!",
      owner.id,
    );
    assert(
      afterMessage.closedMessage === "Sold out for a private event, sorry!",
      `expected the message to be stored, got ${JSON.stringify(afterMessage.closedMessage)}`,
    );
    assert(
      afterMessage.onlineRegistrationBlocked === false,
      "expected onlineRegistrationBlocked to remain false — setting a message must not block the date",
    );
    console.log("PASS: per-date message is settable independent of the block toggle.");

    // 2. Now flip the toggle ON — the message must survive, proving the
    // toggle's scoped update doesn't clobber it.
    const afterToggle = await openPlayCapacityService.setOnlineRegistrationBlockedForDate(
      friday!,
      true,
      owner.id,
    );
    assert(afterToggle.onlineRegistrationBlocked === true, "expected the toggle to be on");
    assert(
      afterToggle.closedMessage === "Sold out for a private event, sorry!",
      `expected the earlier message to survive the toggle write, got ${JSON.stringify(afterToggle.closedMessage)}`,
    );
    console.log(
      "PASS: flipping the block toggle afterward doesn't wipe an earlier per-date message.",
    );

    // Resolver: a real per-date message wins over the global default.
    const resolvedWithOverride = resolveOpenPlayClosedMessage(
      afterToggle.closedMessage,
      globalDefault,
    );
    assert(
      resolvedWithOverride === "Sold out for a private event, sorry!",
      `expected the per-date override to win, got ${JSON.stringify(resolvedWithOverride)}`,
    );

    // 3a. Whitespace-only write — resolver must fall back to the global
    // default, never render a blank block.
    const afterWhitespace = await openPlayCapacityService.setClosedMessageForDate(
      friday!,
      "   ",
      owner.id,
    );
    assert(
      afterWhitespace.closedMessage === null,
      `expected a whitespace-only message to be stored as null, got ${JSON.stringify(afterWhitespace.closedMessage)}`,
    );
    const resolvedWhitespace = resolveOpenPlayClosedMessage(
      afterWhitespace.closedMessage,
      globalDefault,
    );
    assert(
      resolvedWhitespace === globalDefault,
      `expected whitespace-only to resolve to the global default, got ${JSON.stringify(resolvedWhitespace)}`,
    );
    console.log(
      "PASS: a whitespace-only per-date message resolves to the global default, not a blank block.",
    );

    // 3b. Re-set a real message, then clear it with an empty string —
    // proves clearing is a genuine two-way write, not one-way.
    await openPlayCapacityService.setClosedMessageForDate(
      friday!,
      "Back for real this time.",
      owner.id,
    );
    const afterClear = await openPlayCapacityService.setClosedMessageForDate(friday!, "", owner.id);
    assert(
      afterClear.closedMessage === null,
      `expected an empty-string save to clear the override back to null, got ${JSON.stringify(afterClear.closedMessage)}`,
    );
    const resolvedCleared = resolveOpenPlayClosedMessage(afterClear.closedMessage, globalDefault);
    assert(
      resolvedCleared === globalDefault,
      `expected a cleared override to resolve to the global default, got ${JSON.stringify(resolvedCleared)}`,
    );
    console.log(
      "PASS: clearing the per-date field (saving blank) is a real two-way write, not one-way.",
    );

    await cleanUpDate(friday!);
  } catch (error) {
    await cleanUpDate(friday!);
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
