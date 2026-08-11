/**
 * Owner request (2026-08-11): "create a setting for time schedule as
 * well" — up to now Opening/Closing only existed via a one-off seed
 * script, with no updateTemplate method at all. Proves, against real
 * rows, shiftTemplateService:
 *   1. createTemplate makes a real, immediately-listed row.
 *   2. updateTemplate actually changes name/startTime/endTime, and
 *      writes a real audit log entry with before/after values.
 *   3. setTemplateActive(false) hides the shift from nothing (it's not
 *      a delete) but the row and its id still resolve — a past
 *      ScheduleAssignment.templateId would still work.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { shiftTemplateService } from "./shift-template.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const suffix = Date.now();
  const name = `Test Shift ${suffix}`;

  let templateId: string | null = null;

  try {
    // ============== 1. createTemplate ==============
    const created = await shiftTemplateService.createTemplate(
      { name, startTime: "09:00", endTime: "17:00" },
      owner.id,
    );
    templateId = created.id;
    assert(created.startTime === "09:00" && created.endTime === "17:00", "expected the created times to round-trip");
    const listed = await shiftTemplateService.listTemplates();
    assert(listed.some((t) => t.id === created.id), "expected the new template to appear in listTemplates immediately");
    console.log("PASS: createTemplate makes a real, immediately-listed row.");

    // ============== 2. updateTemplate ==============
    const updated = await shiftTemplateService.updateTemplate(
      created.id,
      { name: `${name} (renamed)`, startTime: "10:00", endTime: "18:00" },
      owner.id,
    );
    assert(updated.name === `${name} (renamed)`, `expected the name to change, got ${updated.name}`);
    assert(
      updated.startTime === "10:00" && updated.endTime === "18:00",
      `expected the times to change, got ${updated.startTime}-${updated.endTime}`,
    );
    const reloaded = await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: created.id } });
    assert(
      reloaded.startTime === "10:00" && reloaded.endTime === "18:00",
      "expected the change to be persisted, not just returned",
    );

    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "ShiftTemplate", entityId: created.id, action: "shift_template.updated" },
      orderBy: { createdAt: "desc" },
    });
    assert(auditEntry, "expected a shift_template.updated audit log entry");
    const oldValues = auditEntry!.oldValues as { startTime?: string } | null;
    assert(oldValues?.startTime === "09:00", `expected the audit log's oldValues to record the pre-edit time, got ${JSON.stringify(oldValues)}`);
    console.log("PASS: updateTemplate persists the new name/times and writes a before/after audit log entry.");

    // ============== 3. setTemplateActive doesn't delete ==============
    const deactivated = await shiftTemplateService.setTemplateActive(created.id, false, owner.id);
    assert(deactivated.active === false, "expected setTemplateActive(false) to flip active");
    const stillThere = await prisma.shiftTemplate.findUnique({ where: { id: created.id } });
    assert(stillThere !== null, "expected the row to still exist after deactivating — no delete method exists");
    console.log("PASS: setTemplateActive(false) deactivates without deleting the row.");
  } finally {
    if (templateId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "ShiftTemplate", entityId: templateId } });
      await prisma.shiftTemplate.deleteMany({ where: { id: templateId } });
    }
  }

  console.log("\nPASS: shiftTemplateService.updateTemplate proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
