import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Atomic, gap-tolerant "next sequence number" generator — the replacement
// for every prior count-existing-rows generateNextXReference (fragile: a
// deleted row desyncs the count from the highest sequence actually used,
// causing collisions once enough rows accumulate and get deleted — see
// ARCHITECTURE.md's maintenance addendum). Backed by one ReferenceCounter
// row per scope, incremented via Postgres's canonical atomic upsert —
// `INSERT ... ON CONFLICT DO UPDATE` is race-free under concurrent
// transactions via the scope column's unique index, no application-level
// locking needed, and it participates in whichever transaction `client`
// belongs to (or the default client, if none).
export async function nextSequence(
  scope: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "ReferenceCounter" (scope, value)
    VALUES (${scope}, 1)
    ON CONFLICT (scope) DO UPDATE SET value = "ReferenceCounter"."value" + 1
    RETURNING value
  `;
  return Number(rows[0].value);
}

// Scope key for a daily sequence — every reference except Employee's
// stable EMP-NNNN and OpenPlayMatch's per-session counter resets per
// calendar day.
export function dailyScope(prefix: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${prefix}:${year}${month}${day}`;
}
