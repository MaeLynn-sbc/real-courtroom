// Hardening phase (BUILD-SPEC.md §0 process rule): a fixed setTimeout delay
// proved two of the six concurrency fixes (cancelAssignment, checkIn party
// path) but wasn't committed — the tests that shipped ran unlocked/regressed
// code and passed anyway, because a single-process test harness with fast,
// low-latency local Postgres access makes the natural race window too narrow
// to hit reliably from independent async call starts alone.
//
// This is the permanent, test-only seam: a `RaceHook` is an optional
// callback a service method invokes at exactly the point a race needs
// widening. In production it's always the default no-op (zero cost, not
// even an extra await frame beyond the `?.()` call). In a concurrency test
// it's a `createBarrier(2)` — a rendezvous point that makes two concurrent
// calls provably reach the same line at the same instant, closing out
// scheduling/connection-acquisition jitter instead of hoping a fixed delay
// happens to be wide enough.
export type RaceHook = () => Promise<void> | void;

export const noopRaceHook: RaceHook = () => {};

// Rendezvous barrier for `count` concurrent callers. Every call to the
// returned function blocks until `count` calls have been made, then all of
// them resolve together — deterministic synchronization, not a delay
// hoping for the best. Single-use: create a fresh barrier per race.
export function createBarrier(count: number): RaceHook {
  let arrived = 0;
  let resolveAll: () => void = () => {};
  const allArrived = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived >= count) {
      resolveAll();
    }
    await allArrived;
  };
}
