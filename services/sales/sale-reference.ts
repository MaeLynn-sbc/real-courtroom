// Pure date/sequence formatting — same shape as booking-reference.ts,
// shift-number.ts, etc. The "next sequence number for today" query lives in
// sale.service.ts; this just formats the display string.
export function formatSaleNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const sequencePart = String(sequence).padStart(4, "0");

  return `SALE-${year}${month}${day}-${sequencePart}`;
}
