import { env } from "@/lib/env";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

// Server-only (imports lib/env.ts) — never import this from a "use client"
// file. The QR encodes a URL to the staff-authenticated check-in lookup
// page, not a public self-service link: scanning it only works for a
// signed-in staff member, which is the correct trust model for a
// front-desk-operated check-in.
export async function generateBookingCheckInQrCode(token: string): Promise<string> {
  const baseUrl = env.AUTH_URL ?? "http://localhost:3000";
  const checkInUrl = new URL(
    `/dashboard/bookings/check-in?token=${encodeURIComponent(token)}`,
    baseUrl,
  ).toString();

  return generateQrCodeDataUrl(checkInUrl);
}

// Points straight at the public homepage's live availability grid
// (CourtAvailabilityGrid) — scanning it opens the same schedule a
// customer would see standing in front of the venue, no staff auth
// required (unlike generateBookingCheckInQrCode above).
export async function generateHomeScheduleQrCode(): Promise<string> {
  const baseUrl = env.AUTH_URL ?? "http://localhost:3000";
  const scheduleUrl = new URL("/", baseUrl).toString();
  return generateQrCodeDataUrl(scheduleUrl);
}
