// Pure date/sequence formatting — same pattern as
// services/booking/booking-reference.ts. The "next sequence number for
// today" DB query lives in coach-session.service.ts; this just formats
// the display string.
export function formatCoachSessionReference(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sequencePart = String(sequence).padStart(4, "0");

  return `CS-${year}${month}${day}-${sequencePart}`;
}
