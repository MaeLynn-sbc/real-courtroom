// Pure date/sequence formatting — same shape as sale-reference.ts,
// shift-number.ts, etc. The "next sequence number for today" query lives
// in expense.service.ts; this just formats the display string.
export function formatExpenseNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sequencePart = String(sequence).padStart(4, "0");

  return `EXP-${year}${month}${day}-${sequencePart}`;
}
