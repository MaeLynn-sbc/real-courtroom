import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LockerForm } from "@/features/lockers/components/locker-form";
import { LockerMaintenanceForm } from "@/features/lockers/components/locker-maintenance-form";
import { LockerMaintenanceLogList } from "@/features/lockers/components/locker-maintenance-log-list";
import { LockerRentalForm } from "@/features/lockers/components/locker-rental-form";
import { LockerRentalList } from "@/features/lockers/components/locker-rental-list";
import { LockerStatusBadge } from "@/features/lockers/components/locker-status-badge";
import { LockerTransactionTimeline } from "@/features/lockers/components/locker-transaction-timeline";
import { MODULE_KEYS } from "@/lib/module-flags";
import { lockerRentalService } from "@/services/lockers/locker-rental.service";
import { lockerService } from "@/services/lockers/locker.service";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

interface LockerDetailPageProps {
  params: Promise<{ lockerId: string }>;
}

export async function generateMetadata({ params }: LockerDetailPageProps): Promise<Metadata> {
  const { lockerId } = await params;
  try {
    const locker = await lockerService.getLockerWithComputed(lockerId);
    return { title: locker.code };
  } catch {
    return { title: "Locker" };
  }
}

export default async function LockerDetailPage({ params }: LockerDetailPageProps) {
  const { lockerId } = await params;

  const locker = await lockerService.getLockerWithComputed(lockerId).catch(() => null);
  if (!locker) {
    notFound();
  }

  const [maintenanceLogs, timeline, rentals, players, paymentMethods, enabledModules] = await Promise.all([
    lockerService.listMaintenanceLogs(lockerId),
    lockerService.getTransactionTimeline(lockerId),
    lockerRentalService.listRentals({ lockerId }),
    playerService.listPlayers(),
    saleService.listPaymentMethods(),
    settingsService.getEnabledModules(),
  ]);
  const lockerRentalEnabled = enabledModules[MODULE_KEYS.LOCKER_RENTAL];

  const playerOptions = players.map((player) => ({
    id: player.id,
    label: player.user.name ?? player.user.email ?? "Unknown player",
  }));

  const paymentMethodOptions = paymentMethods.map((method) => ({
    id: method.id,
    label: method.label,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{locker.code}</h1>
        <LockerStatusBadge status={locker.displayStatus} />
      </div>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Details</h2>
          <LockerForm locker={locker} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Rent out</h2>
          {lockerRentalEnabled ? (
            <LockerRentalForm
              lockerId={locker.id}
              players={playerOptions}
              paymentMethods={paymentMethodOptions}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Locker rental is currently unavailable.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Rentals</h2>
        <LockerRentalList rentals={rentals} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Maintenance log</h2>
          <LockerMaintenanceLogList lockerId={locker.id} logs={maintenanceLogs} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Log entry / report damage</h2>
          <LockerMaintenanceForm lockerId={locker.id} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Transaction history</h2>
        <LockerTransactionTimeline events={timeline} />
      </section>
    </div>
  );
}
