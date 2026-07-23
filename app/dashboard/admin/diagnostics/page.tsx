import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { healthService } from "@/services/health/health.service";
import { inventoryAlertsService } from "@/services/inventory/inventory-alerts.service";

export const metadata: Metadata = {
  title: "Diagnostics",
};

// See app/dashboard/admin/settings/page.tsx's comment — same static-
// prerendering trap, doubly important on a page whose whole purpose is
// showing live deployment state.
export const dynamic = "force-dynamic";

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday(): Date {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
}

export default async function DiagnosticsPage() {
  const [health, userCount, bookingsToday, alerts] = await Promise.all([
    healthService.getHealth(),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.booking.count({
      where: { startAt: { gte: startOfToday(), lt: endOfToday() }, status: { notIn: ["CANCELLED"] } },
    }),
    inventoryAlertsService.getAlerts(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
        <p className="text-muted-foreground text-sm">
          Deployment health and a quick operational snapshot for administrators.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Application</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={health.status === "ok" ? "secondary" : "destructive"}>
                {health.status === "ok" ? "Healthy" : "Degraded"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Uptime</span>
              <span className="tabular-nums">{Math.floor(health.uptimeSeconds / 60)}m</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Connectivity</span>
              <Badge variant={health.database === "connected" ? "secondary" : "destructive"}>
                {health.database === "connected" ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Check latency</span>
              <span className="tabular-nums">{health.databaseCheckMs}ms</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Payment</span>
              <span>{health.providers.payment}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{health.providers.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Upload</span>
              <span>{health.providers.upload}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operational snapshot</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active users</span>
              <span className="tabular-nums">{userCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bookings today</span>
              <span className="tabular-nums">{bookingsToday}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Unresolved alerts</span>
              <span className="tabular-nums">{alerts.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {alerts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Unresolved alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {alerts.map((alert, index) => (
                <li key={`${alert.type}-${index}`} className="flex flex-col">
                  <span>{alert.title}</span>
                  {alert.description ? (
                    <span className="text-muted-foreground text-xs">{alert.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
