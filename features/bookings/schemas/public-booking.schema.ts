import { z } from "zod";

// Customer-facing shape (name/phone/court/date/time/duration) — mapped
// onto the existing createBookingSchema server-side by
// actions/public-booking.actions.ts, not a parallel validation set for
// the same booking data createBookingSchema already validates.
//
// BUILD-SPEC.md §4: no email on the public court booking form — phone is
// the only, required way to reach someone about their slot. Booking.guestEmail
// stays nullable in the schema for historical rows and the staff detail
// page; nothing writes to it from this path anymore.
export const publicBookingSchema = z.object({
  guestName: z.string().min(1, "Enter your name.").max(200),
  guestPhone: z.string().min(1, "Enter your phone number.").max(50),
  courtId: z.string().min(1, "Select a court."),
  date: z.string().min(1, "Select a date."),
  time: z.string().min(1, "Select a time."),
  durationMinutes: z.coerce.number().int().positive(),
});

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
