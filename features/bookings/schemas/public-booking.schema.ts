import { z } from "zod";

// Customer-facing shape (name/phone/email/court/date/time/duration) —
// mapped onto the existing createBookingSchema server-side by
// actions/public-booking.actions.ts, not a parallel validation set for
// the same booking data createBookingSchema already validates.
export const publicBookingSchema = z.object({
  guestName: z.string().min(1, "Enter your name.").max(200),
  guestPhone: z.string().min(1, "Enter your phone number.").max(50),
  guestEmail: z.string().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  courtId: z.string().min(1, "Select a court."),
  date: z.string().min(1, "Select a date."),
  time: z.string().min(1, "Select a time."),
  durationMinutes: z.coerce.number().int().positive(),
});

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
