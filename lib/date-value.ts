// "YYYY-MM-DD" for a Date, read in LOCAL time (this process runs
// TZ=Asia/Manila).
//
// Reported live (2026-09-22): every row of the sales report showed the
// day before. A business date is stored as local midnight — Sep 21 is
// `new Date(2026, 8, 21)`, which is 2026-09-20T16:00:00Z — so
// `toISOString().slice(0, 10)` reads back "2026-09-20". Eight hours west
// of Manila, midnight local is always the previous UTC day, so EVERY
// business date came out one day early. The owner spotted it because a
// day's coach payouts were listed against the day before.
//
// Building the string from the local getters instead is the fix, and is
// the same idiom the date pickers in this app already use to write an
// <input type="date"> value. Never use toISOString for a date-only
// value; it is only correct for an instant.
export function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
