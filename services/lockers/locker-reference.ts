// Pure date/sequence formatting — same pattern as
// services/booking/booking-reference.ts.
export function formatLockerRentalReference(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sequencePart = String(sequence).padStart(4, "0");

  return `LR-${year}${month}${day}-${sequencePart}`;
}
