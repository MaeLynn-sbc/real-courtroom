// Pure and dependency-free (no Prisma import) so it's unit-testable without
// a database — same pattern as services/court/court-availability.ts.

export function hasTimeOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}
