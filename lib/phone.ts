// Philippine mobile number normalisation for SMS sending.
//
// WHY THIS EXISTS. Semaphore is handed whatever string the customer typed.
// Production data (audited 2026-08-28) shows four legitimate shapes plus
// separator noise, so a raw pass-through would reject real customers over
// formatting and — worse — would hand junk to a paid API. Every number is
// funnelled through here before a send is even considered.
//
// SHAPES FOUND IN PRODUCTION, and what each becomes:
//     09171234567     ->  09171234567     249 open-play + 126 booking rows
//     +639171234567   ->  09171234567       7 open-play rows
//     639171234567    ->  09171234567       1 open-play row
//     9171234567      ->  09171234567       8 open-play rows
//     0917 123 4567   ->  09171234567      13 rows carry spaces/dashes
//                                          (also (0917)-123-4567 style)
//
// Canonical output is the local 09XXXXXXXXX form, which is what Semaphore's
// own docs use and what the overwhelming majority of stored rows already
// look like — so the normalised value stays comparable against history.
//
// Returns null for anything that is not a valid PH mobile number, and the
// CALLER decides what that means. For SMS that means logging
// SKIPPED_INVALID and sending nothing — never guessing, never "fixing" a
// number into some other subscriber's phone. Real examples this rejects:
// "messenger", "444", "0968636847" (a digit short), "099989713110" (a
// digit long), "." (831 walk-in rows).

// Philippine mobile subscriber numbers are always 10 digits beginning with
// 9 (network prefix 9XX + 7 subscriber digits). Landlines are not mobile
// and cannot receive SMS, so they are deliberately not accepted.
const SUBSCRIBER = /^9\d{9}$/;

// Only true formatting separators. Deliberately NOT stripping letters,
// dots or "+" from the middle — "messenger" and "." must stay invalid
// rather than being scrubbed into something that looks like a number.
const SEPARATORS = /[\s()\-.‐-―]/g;

export function normalizePhilippineMobile(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const compact = raw.replace(SEPARATORS, "");
  if (compact === "") {
    return null;
  }

  // Strip the country code in either of its two written forms, then the
  // trunk zero. What must remain is exactly the 10-digit subscriber number.
  let subscriber: string;
  if (compact.startsWith("+63")) {
    subscriber = compact.slice(3);
  } else if (compact.startsWith("63") && compact.length === 12) {
    // Length-guarded: without it, a local 09XXXXXXXXX beginning "63" after
    // the zero is impossible, but a mistyped 11-digit string starting "63"
    // would be silently truncated into a plausible-looking wrong number.
    subscriber = compact.slice(2);
  } else if (compact.startsWith("0")) {
    subscriber = compact.slice(1);
  } else {
    subscriber = compact;
  }

  if (!SUBSCRIBER.test(subscriber)) {
    return null;
  }

  return `0${subscriber}`;
}
