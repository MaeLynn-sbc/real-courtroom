import { env } from "@/lib/env";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

// Server-only (imports lib/env.ts) — never import from a "use client" file.
// Both live on the TV display admin setup page (BUILD-SPEC.md §13): the
// display QR is what that section was originally spec'd for (scan on a
// phone, open on the TV); the open-play registration QR is a second,
// unrelated destination co-located on the same page rather than a new
// one-off QR screen, since this is already "the place staff go to get a
// venue QR code."

export async function generateDisplayQrCode(slug: string): Promise<string> {
  const baseUrl = env.AUTH_URL ?? "http://localhost:3000";
  const displayUrl = new URL(`/display/${slug}`, baseUrl).toString();
  return generateQrCodeDataUrl(displayUrl);
}

export async function generateOpenPlayRegistrationQrCode(): Promise<string> {
  const baseUrl = env.AUTH_URL ?? "http://localhost:3000";
  const registrationUrl = new URL("/open-play/register", baseUrl).toString();
  return generateQrCodeDataUrl(registrationUrl);
}
