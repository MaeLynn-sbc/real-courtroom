// GSM 03.38 encoding analysis for outbound SMS.
//
// WHY THIS EXISTS (owner requirement, 2026-08-28). An SMS is billed per
// SEGMENT, and the segment size depends on the alphabet the message needs:
//
//     GSM-7   160 chars single / 153 per part when concatenated
//     UCS-2    70 chars single /  67 per part when concatenated
//
// One character outside GSM-7 drags the WHOLE message to UCS-2 and more
// than halves its capacity. Our templates run 110-118 characters — a
// comfortable fit under 160, and instantly over budget under 70. The em
// dash (U+2014) did exactly this to the first drafts; so would a curly
// apostrophe from a copy-paste.
//
// CRITICALLY, this analyses the RENDERED body, not the template. A clean
// template still produces a UCS-2 message once a customer name carrying an
// accent is substituted in — "Jose" is GSM-7, "José" is not, and neither is
// "Peñaflorida". Those are ordinary Filipino names, not edge cases, so the
// check has to happen at send time on the final string.
//
// This does not rewrite or reject anything. It reports, so the dispatcher
// can log a two-segment send as the visible, costed event it is instead of
// letting the bill drift silently.

// GSM 03.38 basic character set — one septet each.
const GSM7_BASIC = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà").split(""),
);

// GSM 03.38 extension table — TWO septets each (an escape plus the char).
const GSM7_EXTENDED = new Set(["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

const GSM7_SINGLE_LIMIT = 160;
const GSM7_CONCAT_LIMIT = 153;
const UCS2_SINGLE_LIMIT = 70;
const UCS2_CONCAT_LIMIT = 67;

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsEncodingAnalysis {
  encoding: SmsEncoding;
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  length: number;
  segments: number;
  /** Characters that forced UCS-2 — empty when the body is GSM-7 clean. */
  offendingCharacters: string[];
}

export function analyzeSmsBody(body: string): SmsEncodingAnalysis {
  const offending = new Set<string>();
  let septets = 0;

  for (const char of body) {
    if (GSM7_BASIC.has(char)) {
      septets += 1;
    } else if (GSM7_EXTENDED.has(char)) {
      septets += 2;
    } else {
      offending.add(char);
    }
  }

  if (offending.size > 0) {
    // UCS-2 counts UTF-16 code units, so an emoji outside the BMP costs
    // two. body.length is already in code units, which is the right unit.
    const length = body.length;
    return {
      encoding: "UCS-2",
      length,
      segments:
        length <= UCS2_SINGLE_LIMIT ? 1 : Math.ceil(length / UCS2_CONCAT_LIMIT),
      offendingCharacters: [...offending],
    };
  }

  return {
    encoding: "GSM-7",
    length: septets,
    segments:
      septets <= GSM7_SINGLE_LIMIT ? 1 : Math.ceil(septets / GSM7_CONCAT_LIMIT),
    offendingCharacters: [],
  };
}

// Convenience for the dispatcher's log line and for template authoring:
// a body is "clean" when it is GSM-7 AND fits one segment.
export function isSingleSegmentGsm7(body: string): boolean {
  const analysis = analyzeSmsBody(body);
  return analysis.encoding === "GSM-7" && analysis.segments === 1;
}
