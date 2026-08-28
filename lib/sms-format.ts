// Date/time rendering for SMS bodies.
//
// Kept apart from the app's display formatters on purpose: an SMS is
// billed by the character and must stay inside GSM-7, so these are short
// ("Fri Aug 28", "7:00 PM-8:00 PM") and ASCII-only — no en dash between
// times, which would silently push the whole message to UCS-2 and halve
// its capacity. lib/sms-templates.test.ts asserts the result.
//
// Times are rendered in Asia/Manila explicitly rather than riding the
// server's locale, so a text always states the hour the customer will
// actually turn up.
const TIME_ZONE = "Asia/Manila";

export function smsDate(value: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

export function smsTime(value: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

// "7:00 PM-8:00 PM" — a hyphen, never an en dash.
export function smsTimeRange(start: Date, end: Date): string {
  return `${smsTime(start)}-${smsTime(end)}`;
}

// Staff type rejection reasons as free text with no maximum length, so a
// long one can push a message to two segments — or five, as the old
// booking rejection did. Truncated to keep the rendered body inside one
// GSM-7 segment.
//
// Cut on a word boundary where possible and closed with three dots, NOT
// the ellipsis character U+2026 — that is outside GSM-7 and would force
// UCS-2, defeating the whole point of trimming.
export function smsTruncateReason(reason: string, maxLength: number): string {
  const clean = reason.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) {
    return clean;
  }
  const cut = clean.slice(0, maxLength - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}
