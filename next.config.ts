import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino/pino-pretty rely on worker_threads + dynamic requires that break
  // when bundled by webpack/Turbopack for the server — keep them external.
  serverExternalPackages: ["pino", "pino-pretty"],
};

export default nextConfig;
