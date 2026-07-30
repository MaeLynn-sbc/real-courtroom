/**
 * Reported live: a small, fully-owned equipment pool (e.g. a Ball
 * Machine the venue owns exactly 2 of) permanently tripped the
 * LOW_STOCK alert at full availability — "2 of 2 available" isn't
 * actually low stock, and the only existing way to silence it
 * (marking the item MAINTENANCE) takes a genuinely-in-service item
 * offline as a side effect. Proves the new per-item
 * Equipment.lowStockAlertDisabled flag actually suppresses the alert
 * for that item, and ONLY that item — a real low-stock item elsewhere
 * must still alert.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { equipmentService } from "../equipment/equipment.service";
import { inventoryAlertsService } from "./inventory-alerts.service";

const NAME_PREFIX = "IT Low-Stock Alert Test — ";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  await prisma.equipment.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUp();

  try {
    // A small, fully-owned, genuinely-in-service pool — quantity 2,
    // nothing rented out, status AVAILABLE. Exactly the shape that was
    // reported as a permanent false alarm.
    const ballMachine = await equipmentService.createEquipment(
      { name: `${NAME_PREFIX}Ball Machine`, type: "BALL_MACHINE", quantity: 2 },
      owner.id,
    );
    // A genuinely low-stock item, left alone — must still alert
    // throughout, proving the fix is per-item, not a global mute.
    const paddles = await equipmentService.createEquipment(
      { name: `${NAME_PREFIX}Paddle`, type: "PADDLE", quantity: 2 },
      owner.id,
    );

    const beforeAlerts = await inventoryAlertsService.getAlerts();
    assert(
      beforeAlerts.some((a) => a.type === "LOW_STOCK" && a.title.includes(ballMachine.name)),
      "expected the fully-owned Ball Machine to trip LOW_STOCK before the fix is applied — proven failing-first",
    );
    assert(
      beforeAlerts.some((a) => a.type === "LOW_STOCK" && a.title.includes(paddles.name)),
      "expected the Paddle to also trip LOW_STOCK (fixture sanity check)",
    );
    console.log("PASS (failing-first): both items trip LOW_STOCK before lowStockAlertDisabled is set.");

    await equipmentService.updateEquipment(
      ballMachine.id,
      { name: ballMachine.name, type: "BALL_MACHINE", quantity: 2, lowStockAlertDisabled: true },
      owner.id,
    );

    const afterAlerts = await inventoryAlertsService.getAlerts();
    assert(
      !afterAlerts.some((a) => a.type === "LOW_STOCK" && a.title.includes(ballMachine.name)),
      "expected the Ball Machine's LOW_STOCK alert to be suppressed once lowStockAlertDisabled is true",
    );
    assert(
      afterAlerts.some((a) => a.type === "LOW_STOCK" && a.title.includes(paddles.name)),
      "expected the Paddle's LOW_STOCK alert to be UNAFFECTED — this must be per-item, not a global mute",
    );
    console.log("PASS: disabling the flag on the Ball Machine suppresses only its own alert; the Paddle's real low-stock alert is untouched.");

    await cleanUp();
    console.log("\nPASS: per-item low-stock alert suppression proven against real rows.");
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
