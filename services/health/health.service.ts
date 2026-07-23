import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export interface HealthReport {
  status: "ok" | "error";
  uptimeSeconds: number;
  database: "connected" | "disconnected";
  databaseCheckMs: number;
  providers: {
    payment: string;
    email: string;
    upload: string;
  };
}

// Single source of truth for "is this deployment healthy" — the public
// /api/health route and the admin diagnostics page both call this instead
// of each doing their own DB ping.
export class HealthService {
  async getHealth(): Promise<HealthReport> {
    const startedAt = Date.now();
    let database: HealthReport["database"] = "connected";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      logger.error({ err: error }, "Health check failed: database unreachable");
      database = "disconnected";
    }

    return {
      status: database === "connected" ? "ok" : "error",
      uptimeSeconds: Math.floor(process.uptime()),
      database,
      databaseCheckMs: Date.now() - startedAt,
      providers: {
        payment: env.PAYMENT_PROVIDER,
        email: env.EMAIL_PROVIDER,
        upload: env.UPLOAD_PROVIDER,
      },
    };
  }
}

export const healthService = new HealthService();
