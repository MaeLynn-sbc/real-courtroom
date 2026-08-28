/**
 * Render the open-play confirmation for a REAL registration — WITHOUT
 * sending anything.
 *
 * Exists because open-play registrations are scarce: the owner had one
 * left and needed to verify the corrected date/time against a row that
 * already exists rather than spend it on a live send.
 *
 * READ-ONLY BY CONSTRUCTION. It never imports the SMS service, never
 * touches smsDispatchService, and writes no SmsLog row. There is no code
 * path from here to Semaphore even if SMS_PROVIDER is set.
 *
 *   npx tsx scripts/render-open-play-sms.ts <registrationId>
 *   npx tsx scripts/render-open-play-sms.ts --latest
 *   npx tsx scripts/render-open-play-sms.ts --list
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { analyzeSmsBody } from "../lib/sms-encoding";
import { smsDate, smsTimeRange } from "../lib/sms-format";
import { openPlayConfirmationBody } from "../lib/sms-templates";

async function list(): Promise<void> {
  const rows = await prisma.openPlayNightRegistration.findMany({
    where: { source: "WEBSITE" },
    orderBy: { registeredAt: "desc" },
    take: 10,
    select: { id: true, playerName: true, phone: true, date: true, sessionId: true, status: true },
  });
  console.log("\n  Ten most recent WEBSITE registrations:\n");
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.playerName.slice(0, 22).padEnd(22)} ${r.status.padEnd(12)} session:${r.sessionId ? "yes" : "NO"}`);
  }
}

async function render(registrationId: string): Promise<void> {
  const registration = await prisma.openPlayNightRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, playerName: true, phone: true, date: true, sessionId: true, source: true, status: true },
  });

  if (!registration) {
    console.error(`No registration found with id ${registrationId}`);
    process.exit(1);
  }

  const session = registration.sessionId
    ? await prisma.openPlayNightSession.findUnique({
        where: { id: registration.sessionId },
        select: { startAt: true, endAt: true },
      })
    : null;

  // Exactly the substitution approveOpenPlayRegistrationPaymentProof makes.
  const body = openPlayConfirmationBody({
    name: registration.playerName,
    date: session ? smsDate(session.startAt) : smsDate(registration.date),
    time: session ? smsTimeRange(session.startAt, session.endAt) : "",
  });
  const analysis = analyzeSmsBody(body);

  console.log("\n--- the row ------------------------------------------------");
  console.log(`  id            ${registration.id}`);
  console.log(`  playerName    ${registration.playerName}`);
  console.log(`  phone         ${registration.phone}`);
  console.log(`  source        ${registration.source}    status ${registration.status}`);
  console.log(`  date (RAW)    ${registration.date.toISOString()}   <- date-only marker, NOT a time`);
  if (session) {
    console.log(`  session start ${session.startAt.toISOString()}`);
    console.log(`  session end   ${session.endAt.toISOString()}`);
  } else {
    console.log(`  session       NONE — the time clause will be omitted`);
  }

  console.log("\n--- what the OLD code produced (the bug) -------------------");
  console.log(`  ...on ${smsDate(registration.date)} at 12:00 AM`);

  console.log("\n--- what WOULD be sent now ---------------------------------");
  console.log(`  ${body}`);
  console.log(`\n  ${analysis.length}/160 chars | ${analysis.encoding} | ${analysis.segments} segment(s) | offenders: ${analysis.offendingCharacters.length ? analysis.offendingCharacters.join(",") : "none"}`);
  console.log("\n  NOTHING WAS SENT. No SmsLog row written.\n");
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    await list();
  } else if (arg === "--latest") {
    const latest = await prisma.openPlayNightRegistration.findFirst({
      where: { source: "WEBSITE" },
      orderBy: { registeredAt: "desc" },
      select: { id: true },
    });
    if (!latest) {
      console.error("No WEBSITE registrations found.");
      process.exit(1);
    }
    await render(latest.id);
  } else {
    await render(arg);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
