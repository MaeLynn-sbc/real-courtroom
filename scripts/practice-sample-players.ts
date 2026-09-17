/**
 * Adds the Practice page's sample players (10 per skill level) from the
 * command line — the same thing its "Add sample players" button does.
 * Practice only: no Player rows, no tabs, no sales (lib/practice.ts).
 *
 *   npx tsx scripts/practice-sample-players.ts
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { practiceService } from "../services/open-play/practice.service";

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const { added } = await practiceService.addSamplePlayers(owner.id);
  console.log(`Added ${added} sample practice players.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
