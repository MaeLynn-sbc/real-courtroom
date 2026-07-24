import { logger } from "@/lib/logger";

// Structural check (matches the isUniqueConstraintViolation helper already
// duplicated in several services) rather than importing
// PrismaClientKnownRequestError from the generated client — avoids pulling
// generated-client internals into a shared lib file for a single field
// check.
function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

// Matches lib/serializable-retry.ts's own isSerializationFailure — same
// underlying Postgres condition (SQLSTATE 40001), just duplicated rather
// than imported (same precedent as isUniqueConstraintViolation's several
// per-service copies). This is the case where runSerializableWithRetry
// exhausted every attempt: every one of DEFAULT_SERIALIZABLE_RETRY_ATTEMPTS
// (5) hit a genuine write conflict before any of them committed — rare in
// a simple two-way race (the loser normally retries once, sees the
// winner's committed row, and gets a clean domain error like
// BookingConflictError instead of ever reaching here), but possible under
// sustained multi-way contention on one exact slot. Without this branch,
// Prisma's raw P2034 text ("Transaction failed due to a write conflict or
// a deadlock. Please retry your transaction") would reach the client
// verbatim — not alarming, but uncurated, unlike every other Prisma code
// this function handles.
function isSerializationFailure(error: unknown): boolean {
  const code = prismaErrorCode(error);
  if (code === "P2034") {
    return true;
  }
  if (code === "P2010") {
    const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta;
    return meta?.driverAdapterError?.cause?.originalCode === "40001";
  }
  return false;
}

interface ActionErrorContext {
  action: string;
  userId?: string;
}

// Every actions/*.ts file's mutating functions funnel their catch block
// through this — logs the real error server-side (closing the "silent
// failure" gap: previously only AuditLog-write failures were ever logged,
// business/validation errors were swallowed into the returned {error}
// string with no server-side trail) and returns a friendly, safe message.
// P2002/P2025 are special-cased so a raw Prisma constraint message never
// reaches the client (confirmed to happen today for Locker.code and
// Player/User.email unique violations).
export function toActionError(error: unknown, context: ActionErrorContext): string {
  const code = prismaErrorCode(error);

  if (code === "P2002") {
    logger.error({ err: error, ...context }, "Action failed: unique constraint violation");
    return "That value is already in use.";
  }

  if (code === "P2025") {
    logger.error({ err: error, ...context }, "Action failed: record not found");
    return "That record no longer exists.";
  }

  if (isSerializationFailure(error)) {
    logger.error({ err: error, ...context }, "Action failed: serialization retries exhausted");
    return "This is taking longer than expected — please try again.";
  }

  logger.error({ err: error, ...context }, "Action failed");
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
