// Pure sequence formatting — the "next sequence number" DB query lives in
// employee.service.ts; this just formats the display string. Unlike
// Booking/Membership/Shift reference codes, an employee number has no date
// component — it's a stable identity, not a per-day sequence.
export function formatEmployeeNumber(sequence: number): string {
  return `EMP-${String(sequence).padStart(4, "0")}`;
}
