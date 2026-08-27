/**
 * One deliberate test message, to one number you name on the command line.
 *
 * Goes through smsDispatchService — NOT the provider directly — on purpose.
 * Calling SemaphoreSmsService.send() would prove only that the HTTP request
 * works. This exercises the whole chain the real triggers use: normalizer,
 * master switch, daily cap, GSM-7 analysis, the dedupe claim, and the
 * SmsLog row. If this works, the triggers will work; if it is bypassed,
 * a green result proves almost nothing.
 *
 * Uses the REAL bookingConfirmation template with realistic values, so
 * what lands on the handset is what a customer would receive.
 *
 *   npx tsx scripts/send-test-sms.ts 09XXXXXXXXX
 *   npx tsx scripts/send-test-sms.ts 09XXXXXXXXX --entity=my-second-test
 *
 * SMS_PROVIDER must be set in the invoking shell for anything to leave the
 * building. Unset (the default) routes to the console logger, which is a
 * useful dry run in its own right.
 */
import "dotenv/config";

import { analyzeSmsBody } from "../lib/sms-encoding";
import { bookingConfirmationBody } from "../lib/sms-templates";
import { prisma } from "../lib/prisma";
import { settingsService } from "../services/settings/settings.service";
import { smsDispatchService } from "../services/sms/sms-dispatch.service";

async function main(): Promise<void> {
  const [rawPhone, ...rest] = process.argv.slice(2);
  if (!rawPhone) {
    console.error("Usage: npx tsx scripts/send-test-sms.ts 09XXXXXXXXX [--entity=<id>]");
    process.exit(1);
  }

  const entityFlag = rest.find((arg) => arg.startsWith("--entity="));
  // Default entity id is stable, so a second run without --entity proves
  // the dedupe guard instead of sending a second message. That is the
  // more useful default for a first live test.
  const entityId = entityFlag ? entityFlag.slice("--entity=".length) : "manual-test-1";

  const body = bookingConfirmationBody({
    shortCode: "5GTWU",
    court: "Court 2",
    date: "Fri Aug 28",
    time: "7:00 PM-8:00 PM",
  });

  const analysis = analyzeSmsBody(body);
  const enabled = await settingsService.getSmsEnabled();
  const { smsSenderName } = await settingsService.getBookingCommunicationSettings();

  console.log("--- what is about to happen -------------------------------");
  console.log(`  provider        ${process.env.SMS_PROVIDER ?? "(unset -> console logger, nothing sends)"}`);
  console.log(`  master switch   ${enabled ? "ON" : "OFF (nothing will send)"}`);
  console.log(`  sender name     ${smsSenderName || "(empty -> Semaphore account default)"}`);
  console.log(`  to              ${rawPhone}`);
  console.log(`  dedupe key      PUBLIC_BOOKING:${entityId}`);
  console.log(`  encoding        ${analysis.encoding}, ${analysis.length} chars, ${analysis.segments} segment(s)`);
  console.log(`  body            ${body}`);
  console.log("-----------------------------------------------------------");

  const outcome = await smsDispatchService.dispatch({
    trigger: "PUBLIC_BOOKING",
    entityId,
    rawPhone,
    body,
  });

  console.log(`\n  OUTCOME: ${outcome}\n`);

  const row = await prisma.smsLog.findFirst({
    where: { trigger: "PUBLIC_BOOKING", entityId },
    orderBy: { createdAt: "desc" },
  });

  if (row) {
    console.log("--- SmsLog row --------------------------------------------");
    console.log(`  id                 ${row.id}`);
    console.log(`  status             ${row.status}`);
    console.log(`  dedupeKey          ${row.dedupeKey ?? "(null - did not claim)"}`);
    console.log(`  phone              ${row.phone ?? "(null - rejected)"}`);
    console.log(`  rawPhone           ${row.rawPhone}`);
    console.log(`  encoding/segments  ${row.encoding} / ${row.segments}`);
    console.log(`  providerMessageId  ${row.providerMessageId ?? "(none)"}`);
    console.log(`  providerStatus     ${row.providerStatus ?? "(none)"}`);
    console.log(`  error              ${row.error ?? "(none)"}`);
    console.log(`  createdAt          ${row.createdAt.toISOString()}`);
    console.log("-----------------------------------------------------------");
    console.log("\n  Match providerMessageId against Semaphore's dashboard.");
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
