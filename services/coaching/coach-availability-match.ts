// Pure and dependency-free (no Prisma import), same pattern as
// services/booking/booking-availability.ts's hasTimeOverlap — but this is
// deliberately NOT an overlap check. A coach's availability window must
// fully contain the slot being booked; a window that only partially
// overlaps the slot does not qualify (the coach isn't actually free for
// the whole thing).
export function isSlotFullyCovered(
  slotStart: Date,
  slotEnd: Date,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return windowStart <= slotStart && windowEnd >= slotEnd;
}
