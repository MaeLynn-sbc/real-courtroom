import { NextResponse } from "next/server";

import { healthService } from "@/services/health/health.service";

export async function GET() {
  const health = await healthService.getHealth();

  return NextResponse.json(
    {
      status: health.status,
      uptimeSeconds: health.uptimeSeconds,
      database: health.database,
      checkedInMs: health.databaseCheckMs,
    },
    { status: health.status === "ok" ? 200 : 503 },
  );
}
