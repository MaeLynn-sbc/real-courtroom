// Gate 1 (shift cash reconciliation). Philippine peso denominations in
// circulation — bills down to ₱20 (also minted as a coin; listed once,
// the physical form doesn't matter for a cash count), then coins to ₱1.
// Sentimo coins (₱0.25 and smaller) are deliberately excluded — the
// rest of this app already treats peso amounts as whole numbers
// (openingCashCents/closingCashCents inputs both reject fractional
// pesos), and counting centavos at a court-side cash drawer isn't a
// real operational need here.
export const CASH_DENOMINATIONS_PESOS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

export type CashDenominationPesos = (typeof CASH_DENOMINATIONS_PESOS)[number];

// Keyed by the denomination's peso value as a string (JSON object keys
// are always strings) — e.g. { "1000": 5, "500": 2 } is 5×₱1000 +
// 2×₱500. Partial: a denomination with zero counted doesn't need an
// entry.
export type CashDenominationBreakdown = Record<string, number>;

// The one place this sum is computed — both the live client-side
// preview (as staff type quantities) and the server's authoritative
// recomputation (shiftService.endShift, which never trusts a client-
// submitted total for money) call this same function, not two
// independent implementations that could drift.
export function sumCashDenominationBreakdown(breakdown: CashDenominationBreakdown): number {
  let totalCents = 0;
  for (const denomination of CASH_DENOMINATIONS_PESOS) {
    const quantity = breakdown[String(denomination)];
    if (typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0) {
      totalCents += denomination * 100 * quantity;
    }
  }
  return totalCents;
}
