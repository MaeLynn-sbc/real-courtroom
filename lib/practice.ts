// Practice mode (owner, 2026-09-17): a sandbox for trying the open play
// rotation — sample names, courts, staged sets, timers — on the real
// /rtv, before it replaces the regular open play and unli play flow.
//
// All practice data lives on ONE fixed date that no real session, report
// or reconciliation will ever read: Monday 3 January 2000. A Monday so
// the weeknight rules apply (no Fri/Sat session, capacity or prepayment).
// Every open play table is keyed by date, so the whole rotation engine
// works on it unchanged, and "Clear practice" is one date's worth of
// rows.
//
// NO MONEY, EVER: practice players are never checked in (so no tab is
// opened), never linked to a real player, and a finished practice game
// is never billed (completeAssignment skips creditGame on this date).
// With no tab there is nothing to settle, so no Sale can exist.
export const PRACTICE_DATE_VALUE = "2000-01-03";

export function practiceDate(): Date {
  return new Date(`${PRACTICE_DATE_VALUE}T00:00:00`);
}

export function isPracticeDate(date: Date): boolean {
  const practice = practiceDate();
  return (
    date.getFullYear() === practice.getFullYear() &&
    date.getMonth() === practice.getMonth() &&
    date.getDate() === practice.getDate()
  );
}
