/**
 * Merge duplicate walk-in players (owner request, 2026-09-17).
 *
 *   npx tsx scripts/merge-duplicate-players.ts            # dry run, changes nothing
 *   npx tsx scripts/merge-duplicate-players.ts --apply    # writes
 *
 * Why duplicates exist: walk-in check-in only matched an existing player
 * by a real 10-digit phone, and staff type "1" or "." at the desk, so
 * every visit created a new player. Fixed at the source in
 * open-play-registration.service.ts (name match when the phone is junk);
 * this script cleans up what was already created.
 *
 * Rules — deliberately conservative:
 *  - A group is active players whose names match ignoring case and
 *    spacing.
 *  - A group is SKIPPED when two rows carry DIFFERENT real phone numbers:
 *    that is the one signal they may be different people. Those are
 *    listed for the owner to resolve by hand (Players tab, Edit/Delete).
 *  - A group is SKIPPED when more than one row has a login (email,
 *    username or password). Merging real accounts is not a cleanup.
 *  - The keeper is the row with a login if there is one, else the oldest. Every booking, registration, sale,
 *    coach session, membership, rental and team slot on the others is
 *    moved onto it. The others are soft-deleted (Player.deletedAt), the
 *    same as the Delete button, so nothing is destroyed.
 *  - The keeper inherits a real phone and an open play level from the
 *    others when it has none. Its name becomes the group's best-cased
 *    spelling ("Aaron" over "aaron" / "AARON").
 *  - Rows that cannot move because of a unique rule (one rating, one
 *    statistics row per player; one old-style registration per session)
 *    stay on the soft-deleted duplicate — still in the database, just
 *    not double-counted.
 *
 * Idempotent: a second run finds nothing left to merge in the groups it
 * already handled. One transaction per group, so a failure leaves every
 * other group intact. Every merge writes a `player.merged` audit entry.
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { loadActivePlayers, mergeGroup, planMerges } from "../services/player/player-merge";

const APPLY = process.argv.includes("--apply");

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const players = await loadActivePlayers();
  const { toMerge, phoneConflicts, loginConflicts } = planMerges(players);

  const extra = toMerge.reduce((n, g) => n + g.dups.length, 0);
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${players.length} active players`);
  console.log(`Groups to merge: ${toMerge.length} (${extra} duplicate rows)`);
  console.log(`Skipped, different real phones: ${phoneConflicts.length}`);
  console.log(`Skipped, more than one login: ${loginConflicts.length}`);

  let merged = 0;
  for (const { keeper, dups } of toMerge) {
    if (!APPLY) {
      console.log(`  merge ${dups.length + 1}x "${keeper.user.name}" -> keep ${keeper.id}`);
      continue;
    }
    const result = await prisma.$transaction((tx) => mergeGroup(tx, keeper, dups, owner.id));
    merged += dups.length;
    console.log(`  merged ${dups.length + 1}x -> "${result.name}" ${JSON.stringify(result.moved)}`);
  }

  console.log("\nLeft for the owner to decide (same name, different real phones):");
  for (const c of phoneConflicts) console.log(`  ${c.name} — ${c.rows} rows — ${c.phones.join(", ")}`);
  if (loginConflicts.length) {
    console.log("\nLeft alone (more than one real account):");
    for (const c of loginConflicts) console.log(`  ${c.name} — ${c.rows} rows`);
  }
  if (APPLY) {
    console.log(`\nDone. ${merged} duplicate rows folded in. Active players now: ${await prisma.player.count({ where: { deletedAt: null } })}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
