// Pure, DOM-free scheduling logic for the TV display's repeated voice
// announcements — extracted out of tv-display-client.tsx specifically so
// the cancel-on-new-assignment behavior is unit-testable with fake
// timers alone, without needing to drive the whole component, its poll
// loop, or a mocked speechSynthesis.
export interface AnnouncementRepeater {
  // Speaks `text` once immediately, then schedules the configured number
  // of repeats (getRepeatCount() - 1), one gapMs apart. Cancels any
  // still-pending repeat chain from a PREVIOUS call first — a fresh
  // assignment always wins over finishing a stale repeat, rather than
  // the two interleaving or repeats piling up behind newer ones.
  schedule(text: string): void;
  // Drops any pending repeat without scheduling a new one — used when
  // muting (a pending repeat must not survive a mute) and on teardown.
  cancelPending(): void;
}

export function createAnnouncementRepeater(options: {
  speak: (text: string) => void;
  gapMs: number;
  getRepeatCount: () => number;
}): AnnouncementRepeater {
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  function cancelPending(): void {
    if (pendingTimeout !== null) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function scheduleRepeats(text: string, remaining: number): void {
    if (remaining <= 0) return;
    pendingTimeout = setTimeout(() => {
      pendingTimeout = null;
      options.speak(text);
      scheduleRepeats(text, remaining - 1);
    }, options.gapMs);
  }

  function schedule(text: string): void {
    cancelPending();
    options.speak(text);
    // Repeat count is "how many times total," so the chain schedules
    // one fewer than that after the immediate speak() above. Floored at
    // 1 total play — a repeat count of 0 would mean "never announce at
    // all," which isn't a real setting this exposes (the admin control
    // is bounded 1-5) and isn't a sensible interpretation of "how many
    // times does it repeat" regardless.
    scheduleRepeats(text, Math.max(1, options.getRepeatCount()) - 1);
  }

  return { schedule, cancelPending };
}
