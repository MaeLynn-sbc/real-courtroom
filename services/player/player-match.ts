import type { Prisma } from "@/lib/generated/prisma/client";

// "Is this the same person we already have?" — asked by every flow that
// used to create a player unconditionally: walk-in check-in, the Players
// tab's New player form, and tournament registration. Owner (2026-09-17):
// "every time the staff inputs a new player for registration, make sure
// that it merges with the existing, providing they are the same." One
// rule, in one place, so the three flows can never disagree — and the
// same rule scripts/merge-duplicate-players.ts used to clean up history.
//
// In order:
//  1. A real phone (10 digits after stripping) that matches → same person.
//  2. An email that matches → same person.
//  3. The same name (case and spacing ignored) → same person, UNLESS the
//     two sides carry different real phones or different emails. Those
//     are the only signals we have that two people share a name.
//     When the new entry has no real phone and the only same-name
//     players have real phones, they still match if they all share ONE
//     number; two different numbers means two people and we can't tell
//     which, so nothing matches and a new player is created.
//
// Staff type "1" or "." for the phone at the desk; those are not phones.

export const phoneDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").slice(-10);
export const realPhone = (value: string | null | undefined) => (phoneDigits(value).length === 10 ? phoneDigits(value) : null);
export const normalizePlayerName = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");

export interface PlayerMatchInput {
  name: string;
  phone?: string | null;
  email?: string | null;
}

export interface MatchedPlayer {
  playerId: string;
  userId: string;
  phone: string | null;
  email: string | null;
  matchedBy: "phone" | "email" | "name";
}

export async function findMatchingPlayer(
  tx: Prisma.TransactionClient,
  input: PlayerMatchInput,
): Promise<MatchedPlayer | null> {
  const phone = realPhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const name = normalizePlayerName(input.name);

  const toMatch = (
    row: { id: string; phone: string | null; user: { id: string; email: string | null } },
    matchedBy: MatchedPlayer["matchedBy"],
  ): MatchedPlayer => ({ playerId: row.id, userId: row.user.id, phone: row.phone, email: row.user.email, matchedBy });
  const select = { id: true, phone: true, user: { select: { id: true, email: true } } } as const;

  if (phone) {
    // Stored phones are free text ("0917 123 4567", "+63917..."), so the
    // comparison happens on digits in code, over players that have one.
    const withPhone = await tx.player.findMany({
      where: { deletedAt: null, phone: { not: null } },
      select,
      orderBy: { createdAt: "asc" },
    });
    const byPhone = withPhone.find((row) => realPhone(row.phone) === phone);
    if (byPhone) return toMatch(byPhone, "phone");
  }

  if (email) {
    const byEmail = await tx.player.findFirst({
      where: { deletedAt: null, user: { email: { equals: email, mode: "insensitive" } } },
      select,
      orderBy: { createdAt: "asc" },
    });
    if (byEmail) return toMatch(byEmail, "email");
  }

  if (!name) return null;
  const sameName = await tx.player.findMany({
    where: { deletedAt: null, user: { name: { equals: name, mode: "insensitive" } } },
    select,
    orderBy: { createdAt: "asc" },
  });
  // A different email on file is a different person.
  const compatible = sameName.filter((row) => !email || !row.user.email || row.user.email.toLowerCase() === email);

  const withoutPhone = compatible.find((row) => !realPhone(row.phone));
  if (withoutPhone) return toMatch(withoutPhone, "name");
  if (phone) return null; // every same-name player has a different real phone

  const phones = new Set(compatible.map((row) => realPhone(row.phone)));
  if (compatible.length > 0 && phones.size === 1) return toMatch(compatible[0], "name");
  return null;
}
