// Pure date/sequence formatting — same pattern as
// services/booking/booking-reference.ts's formatBookingReference, 3-digit
// sequence instead of 4 to match "SHIFT-20260722-001".
export function formatShiftNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sequencePart = String(sequence).padStart(3, "0");

  return `SHIFT-${year}${month}${day}-${sequencePart}`;
}
