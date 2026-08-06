// Short booking code (2026-08-06): a 6-char code shown to customers
// instead of the full bookingReference (BK-YYYYMMDD-NNNN) — easier to
// read back over the phone, off an SMS, or at the door. Alphabet
// deliberately excludes 0/O, 1/I/L — the characters people misread most
// often on a small phone screen or a low-res screenshot.
//
// Generated inside the SAME Serializable-retry transaction as
// bookingReference/qrCodeToken (see booking.service.ts's createBooking/
// createBookingHold) — a same-code collision surfaces as a real Postgres
// unique-constraint violation on Booking.shortCode (@unique), which
// runSerializableWithRetry already retries the whole transaction on,
// generating a fresh code every attempt. At 31^6 (~887 million)
// combinations, a collision is rare but not negligible the way a UUID's
// is — unlike qrCodeToken, this one genuinely needs the retry.
const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SHORT_CODE_LENGTH = 6;

export function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    code += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return code;
}
