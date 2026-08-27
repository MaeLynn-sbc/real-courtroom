/**
 * Owner question (2026-08-28): "why does getBookingCommunicationSettings
 * use getJsonValue as-is while getCourtHours merges over defaults? That
 * inconsistency will bite someone again."
 *
 * THE TRAP. getJsonValue returns the stored row VERBATIM. A row saved
 * before a field existed — or written partially by a script — comes back
 * missing that field entirely, as undefined, with the default silently
 * skipped. getCourtHours and getOpenPlaySettings each learned this the
 * hard way and grew their own bespoke merge; every other object-shaped
 * getter still had the original behaviour.
 *
 * This is not hypothetical for the SMS work: setting smsSenderName alone
 * would have left smsConfirmationTemplate and pageConfirmationCopy
 * undefined, breaking the existing booking-confirmation SMS and the
 * public confirmation page copy at the same time.
 *
 * Proves:
 *   1. A PARTIAL bookingCommunication row fills its absent fields from
 *      the defaults instead of returning undefined.
 *   2. A stored field always WINS over the default — merging must not
 *      resurrect a value the owner deliberately changed.
 *   3. Same for gcashPaymentInfo, whose partial row is the shape that
 *      actually caused the QR outage.
 *   4. ARRAY-valued settings are untouched. This is why the fix is a
 *      separate helper and not a change to getJsonValue itself: shallow-
 *      merging an array ({...[], ...[a,b]}) turns it into an object and
 *      would corrupt otherRates and galleryImages.
 *   5. A boolean `false` stored against a `true` default survives — the
 *      classic spread-vs-falsy bug.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { CMS_KEYS } from "../../lib/cms-keys";
import { prisma } from "../../lib/prisma";
import { settingsService } from "./settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const GAME_WARNING_KEY = "display.gameWarning";
const TOUCHED_KEYS = [
  CMS_KEYS.BOOKING_COMMUNICATION,
  CMS_KEYS.GCASH_PAYMENT_INFO,
  CMS_KEYS.OTHER_RATES,
  GAME_WARNING_KEY,
];

// These tests WRITE settings rows, so whatever was there first has to come
// back afterwards — a developer's local CMS content is not the test's to
// destroy.
async function snapshot() {
  const rows = await prisma.setting.findMany({ where: { key: { in: TOUCHED_KEYS } } });
  return new Map(rows.map((row) => [row.key, row.value]));
}

async function restore(saved: Map<string, unknown>) {
  for (const key of TOUCHED_KEYS) {
    const original = saved.get(key);
    if (original === undefined) {
      await prisma.setting.deleteMany({ where: { key } });
    } else {
      await prisma.setting.upsert({
        where: { key },
        update: { value: original as object },
        create: { key, value: original as object },
      });
    }
  }
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as object },
    create: { key, value: value as object },
  });
}

async function main(): Promise<void> {
  const saved = await snapshot();

  try {
    // ============== 1 & 2. Partial bookingCommunication ==============
    // Exactly the write the SMS work needs to make: sender name only.
    await writeRaw(CMS_KEYS.BOOKING_COMMUNICATION, { smsSenderName: "CourtroomPH" });

    const comms = await settingsService.getBookingCommunicationSettings();
    assert(
      comms.smsSenderName === "CourtroomPH",
      `the stored field must win, got ${JSON.stringify(comms.smsSenderName)}`,
    );
    assert(
      typeof comms.smsConfirmationTemplate === "string" && comms.smsConfirmationTemplate.length > 0,
      `smsConfirmationTemplate must fall back to its default, got ${JSON.stringify(comms.smsConfirmationTemplate)}`,
    );
    assert(
      typeof comms.pageConfirmationCopy === "string" && comms.pageConfirmationCopy.length > 0,
      `pageConfirmationCopy must fall back to its default, got ${JSON.stringify(comms.pageConfirmationCopy)}`,
    );
    console.log("PASS: a partial bookingCommunication row keeps its stored field and fills the rest from defaults.");

    // ============== 3. Partial gcashPaymentInfo ==============
    await writeRaw(CMS_KEYS.GCASH_PAYMENT_INFO, { qrImageUrl: "/uploads/abc.png" });

    const gcash = await settingsService.getGcashPaymentInfo();
    assert(gcash.qrImageUrl === "/uploads/abc.png", "the stored QR url must win");
    assert(
      gcash.accountName === "" && gcash.accountNumber === "",
      `absent gcash fields must be their defaults, got ${JSON.stringify(gcash)}`,
    );
    console.log("PASS: a partial gcashPaymentInfo row fills accountName/accountNumber from defaults.");

    // ============== 4. Arrays are NOT merged ==============
    await writeRaw(CMS_KEYS.OTHER_RATES, [
      { label: "Racket rental", price: "100" },
      { label: "Shuttle", price: "50" },
    ]);

    const rates = await settingsService.getOtherRates();
    assert(Array.isArray(rates), `otherRates must stay an ARRAY, got ${JSON.stringify(rates)}`);
    assert(rates.length === 2, `otherRates must keep both entries, got ${rates.length}`);
    console.log("PASS: array-valued settings are returned as arrays, uncorrupted by any merge.");

    // ============== 5. A stored `false` beats a `true` default ==============
    await writeRaw(GAME_WARNING_KEY, { enabled: false });

    const warning = await settingsService.getGameWarningSettings();
    assert(
      warning.enabled === false,
      `a stored false must survive the merge, got ${JSON.stringify(warning.enabled)}`,
    );
    assert(
      warning.minutes === 1,
      `the absent minutes field must come from the default, got ${JSON.stringify(warning.minutes)}`,
    );
    console.log("PASS: a stored `false` overrides a `true` default, and the absent sibling still fills in.");

    console.log("\nPASS: partial setting rows merge over their defaults across every object-shaped getter.");
  } finally {
    await restore(saved);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
