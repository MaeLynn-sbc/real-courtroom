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

  logger.error({ err: error, ...context }, "Action failed");
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
