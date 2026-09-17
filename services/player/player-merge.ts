import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Duplicate walk-in players: planning and merging. See
// scripts/merge-duplicate-players.ts for the rules and why they exist.
// Kept here, not in the script, so an integration test can prove the
// merge against a real database without running the whole cleanup.

const last10 = (value: string | null) => (value ?? "").replace(/\D/g, "").slice(-10);
const realPhone = (value: string | null) => (last10(value).length === 10 ? last10(value) : null);
const nameKey = (value: string | null) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// "Aaron" beats "aaron" and "AARON": prefer a spelling that is neither
// all-lower nor all-upper, then the keeper's own. Short all-caps names
// like "TA" have no better spelling and stay as they are.
function bestName(names: string[], keeperName: string): string {
  const mixed = names.find((n) => n.trim() !== n.trim().toLowerCase() && n.trim() !== n.trim().toUpperCase());
  return (mixed ?? keeperName).trim().replace(/\s+/g, " ");
}

export type MergeRow = Awaited<ReturnType<typeof loadActivePlayers>>[number];

export async function loadActivePlayers() {
  return prisma.player.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      phone: true,
      openPlaySkillLevel: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true, username: true, passwordHash: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function mergeGroup(tx: Prisma.TransactionClient, keeper: MergeRow, dups: MergeRow[], actorUserId: string) {
  const dupIds = dups.map((d) => d.id);
  const moved: Record<string, number> = {};
  const count = (label: string, result: { count: number }) => {
    if (result.count) moved[label] = (moved[label] ?? 0) + result.count;
  };
  const to = { playerId: keeper.id };

  count("bookings", await tx.booking.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("coachSessions", await tx.coachSession.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("memberships", await tx.membership.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("openPlayNightRegistrations", await tx.openPlayNightRegistration.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("equipmentRentals", await tx.equipmentRental.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("lockerRentals", await tx.lockerRental.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("sales", await tx.sale.updateMany({ where: { playerId: { in: dupIds } }, data: to }));
  count("teamsAsPlayer1", await tx.team.updateMany({ where: { player1Id: { in: dupIds } }, data: { player1Id: keeper.id } }));
  count("teamsAsPlayer2", await tx.team.updateMany({ where: { player2Id: { in: dupIds } }, data: { player2Id: keeper.id } }));

  // Old-style registrations are unique per (session, player): move only
  // the ones for sessions the keeper is not already in.
  const keeperSessions = new Set(
    (await tx.openPlayRegistration.findMany({ where: { playerId: keeper.id }, select: { openPlaySessionId: true } })).map(
      (r) => r.openPlaySessionId,
    ),
  );
  for (const reg of await tx.openPlayRegistration.findMany({
    where: { playerId: { in: dupIds } },
    select: { id: true, openPlaySessionId: true },
  })) {
    if (keeperSessions.has(reg.openPlaySessionId)) continue;
    await tx.openPlayRegistration.update({ where: { id: reg.id }, data: to });
    keeperSessions.add(reg.openPlaySessionId);
    moved.openPlayRegistrations = (moved.openPlayRegistrations ?? 0) + 1;
  }

  const inheritedPhone = realPhone(keeper.phone) ? null : dups.map((d) => d.phone).find((p) => realPhone(p)) ?? null;
  const inheritedLevel = keeper.openPlaySkillLevel
    ? null
    : [...dups].reverse().find((d) => d.openPlaySkillLevel)?.openPlaySkillLevel ?? null;
  const name = bestName([keeper.user.name ?? "", ...dups.map((d) => d.user.name ?? "")], keeper.user.name ?? "");

  await tx.player.update({
    where: { id: keeper.id },
    data: {
      ...(inheritedPhone ? { phone: inheritedPhone } : {}),
      ...(inheritedLevel ? { openPlaySkillLevel: inheritedLevel } : {}),
    },
  });
  if (name && name !== keeper.user.name) {
    await tx.user.update({ where: { id: keeper.user.id }, data: { name } });
  }
  await tx.player.updateMany({ where: { id: { in: dupIds } }, data: { deletedAt: new Date() } });

  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: "player.merged",
      entityType: "Player",
      entityId: keeper.id,
      oldValues: { mergedPlayerIds: dupIds, keeperName: keeper.user.name, keeperPhone: keeper.phone },
      newValues: { name, phone: inheritedPhone ?? keeper.phone, openPlaySkillLevel: inheritedLevel ?? keeper.openPlaySkillLevel, moved },
      metadata: { source: "scripts/merge-duplicate-players.ts" },
    },
  });

  return { name, moved, inheritedPhone, inheritedLevel };
}


export interface MergePlan {
  toMerge: { keeper: MergeRow; dups: MergeRow[] }[];
  phoneConflicts: { name: string; phones: string[]; rows: number }[];
  loginConflicts: { name: string; rows: number }[];
}

export function planMerges(players: MergeRow[]): MergePlan {
  const groups = new Map<string, MergeRow[]>();
  for (const p of players) {
    const key = nameKey(p.user.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const plan: MergePlan = { toMerge: [], phoneConflicts: [], loginConflicts: [] };
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const phones = [...new Set(rows.map((r) => realPhone(r.phone)).filter((p): p is string => p !== null))];
    if (phones.length > 1) {
      plan.phoneConflicts.push({ name: rows[0].user.name ?? "", phones, rows: rows.length });
      continue;
    }
    const withLogin = rows.filter((r) => r.user.email || r.user.username || r.user.passwordHash);
    if (withLogin.length > 1) {
      plan.loginConflicts.push({ name: rows[0].user.name ?? "", rows: rows.length });
      continue;
    }
    // A row with a login is the keeper when there is one; otherwise the oldest.
    const keeper = withLogin[0] ?? rows[0];
    plan.toMerge.push({ keeper, dups: rows.filter((r) => r.id !== keeper.id) });
  }
  return plan;
}
