import QRCode from "qrcode";

import { env } from "@/lib/env";

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

  return QRCode.toDataURL(checkInUrl, { margin: 1, width: 240 });
}
