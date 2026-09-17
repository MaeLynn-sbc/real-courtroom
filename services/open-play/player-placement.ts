import { prisma } from "@/lib/prisma";
import { stagedSlotLabel } from "@/lib/staged-slots";

// Where each checked-in player is right now, in words staff can act on
// (owner, 2026-09-17: "add below the players name where they should be
// assigned"). One lookup for the regular open play Settle list and the
// Practice page, so both say the same thing.
//
//   "On Court 2"          playing now
//   "Called to Court 1"   assigned, timer not started
//   "Next up" / "Rack 3"  in the waiting line
//   "Waiting"             checked in, not placed yet
//   "Resting" / "Done for the night"
export async function getPlacementsForDate(date: Date): Promise<Map<string, string>> {
  const [entries, assignments] = await Promise.all([
    prisma.queueEntry.findMany({
      where: { date },
      select: { registrationId: true, status: true, stagedGroup: { select: { slot: true } } },
    }),
    prisma.gameAssignment.findMany({
      where: { date, status: { in: ["ACTIVE", "PROPOSED"] } },
      select: {
        status: true,
        court: { select: { name: true } },
        participants: { select: { registrationId: true } },
      },
    }),
  ]);

  const placements = new Map<string, string>();
  for (const entry of entries) {
    if (entry.status === "RESTING") placements.set(entry.registrationId, "Resting");
    else if (entry.status === "DONE") placements.set(entry.registrationId, "Done for the night");
    else if (entry.stagedGroup)
      placements.set(entry.registrationId, stagedSlotLabel(entry.stagedGroup.slot));
    else placements.set(entry.registrationId, "Waiting");
  }
  // A court beats everything: a player on court is never also "waiting".
  for (const assignment of assignments) {
    const label =
      assignment.status === "ACTIVE"
        ? `On ${assignment.court.name}`
        : `Called to ${assignment.court.name}`;
    for (const participant of assignment.participants) {
      placements.set(participant.registrationId, label);
    }
  }
  return placements;
}
