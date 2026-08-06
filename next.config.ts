import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino/pino-pretty rely on worker_threads + dynamic requires that break
  // when bundled by webpack/Turbopack for the server — keep them external.
  serverExternalPackages: ["pino", "pino-pretty"],
  experimental: {
    // Real incident (2026-08-06): a customer's real phone screenshot
    // (2-6MB is routine, especially on newer/high-res phones) is sent as
    // base64 inside submitPublicBookingPaymentProofAction/
    // submitBookingPaymentProofAction's Server Action call — base64
    // inflates the raw bytes by ~33%. Next's default Server Action body
    // limit is 1MB, well under what a real screenshot needs, so the
    // upload failed with a bare 500 and no useful error message —
    // confirmed by reproducing it locally with a 7MB test image before
    // this fix (POST /book -> 500, "Your slot is booked, but the
    // screenshot upload failed"). 10mb comfortably covers real photo/
    // screenshot sizes while still bounding the payload on this
    // unauthenticated public endpoint (already rate-limited separately,
    // see lib/rate-limit.ts's use in both submit actions).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
