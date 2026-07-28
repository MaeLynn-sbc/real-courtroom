// Pure, dependency-free conversions between "which whole hours are on"
// and "minimal set of contiguous start/end windows" — shared by the
// coach-availability day editor (and, later, anything else that wants
// tap-to-toggle hour selection backed by start/end database rows rather
// than one row per hour). No DB, no Date math beyond plain hour numbers
// (0-23) — callers attach a real calendar date separately.

export interface HourWindow {
  startHour: number;
  // Exclusive, same convention as a slot's own endAt — a window
  // covering 7-9 AM has startHour 7, endHour 9.
  endHour: number;
}

// Sorted, deduplicated hours in -> the fewest windows that cover exactly
// those hours and no others. [7,8,9,14] -> [{7,10},{14,15}].
export function mergeHoursIntoWindows(hours: number[]): HourWindow[] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const windows: HourWindow[] = [];

  for (const hour of sorted) {
    const last = windows[windows.length - 1];
    if (last && last.endHour === hour) {
      last.endHour = hour + 1;
    } else {
      windows.push({ startHour: hour, endHour: hour + 1 });
    }
  }

  return windows;
}

// The inverse — a window back into the individual hours it covers.
export function expandWindowToHours(window: HourWindow): number[] {
  const hours: number[] = [];
  for (let hour = window.startHour; hour < window.endHour; hour++) {
    hours.push(hour);
  }
  return hours;
}
