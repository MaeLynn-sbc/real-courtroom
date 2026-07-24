import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// Hardening phase (BUILD-SPEC.md §0/§15): extracted from
// booking.service.ts's createBooking, which had this Serializable+retry
// loop inline since Phase 10. The same shape — Serializable isolation,
// catch P2034/P2010-wrapped-40001, retry; anything else propagates
// immediately — is independently duplicated in locker-rental.service.ts,
// match.service.ts, and equipment-rental.service.ts. Only
// booking.service.ts is routed through this shared version for now
// (createBooking); those other three are out of scope for this pass and
// untouched.

export const DEFAULT_SERIALIZABLE_RETRY_ATTEMPTS = 5;

// Postgres aborts the losing side of a Serializable transaction conflict
// with this code — Prisma surfaces it as P2034 for a normal ORM query.
// v1.1 maintenance (booking.service.ts): nextSequence's atomic counter
// increment (lib/reference-counter.ts) is a raw query, and the identical
// underlying Postgres conflict surfaces through *that* path as P2010
// ("raw query failed") wrapping SQLSTATE 40001, not P2034 — both are the
// same Postgres-level condition, just reported through two different
// Prisma error shapes depending on which query layer hit it.
function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "P2034") {
    return true;
  }
  if (code === "P2010") {
    const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta;
    return meta?.driverAdapterError?.cause?.originalCode === "40001";
  }
  return false;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

// Runs `fn` inside a Serializable transaction, retrying only on a genuine
// Postgres serialization conflict or a unique-constraint collision (e.g. a
// reference/token generated inside the transaction colliding with another
// in-flight attempt) — any other error, including a caller's own
// domain-specific conflict error (BookingConflictError and similar),
// propagates immediately on the first attempt, since retrying an error
// that isn't a transient DB-level conflict will only fail the same way
// again.
export async function runSerializableWithRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_SERIALIZABLE_RETRY_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isUniqueConstraintViolation(error) || isSerializationFailure(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Transaction failed after several attempts.");
}
