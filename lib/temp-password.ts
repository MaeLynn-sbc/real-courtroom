import { randomInt } from "node:crypto";

// Excludes visually-ambiguous characters (0/O, 1/I/l) — this is read off a
// screen by an admin and typed in by a new employee once, so ambiguity
// costs a support interruption, not just aesthetics. node:crypto's
// randomInt, not Math.random — this is a credential, not a UI id.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 12;

// System-generated only — there is no code path that lets an admin type
// or choose this value (see employee.service.ts's createEmployee/
// resetPassword). Returned once as plaintext to the caller for one-time
// display; never persisted or logged anywhere, only its bcrypt hash is.
export function generateTempPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
