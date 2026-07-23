import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EquipmentConditionBadge } from "@/features/equipment/components/equipment-condition-badge";
import { EquipmentForm } from "@/features/equipment/components/equipment-form";
import { EquipmentMaintenanceForm } from "@/features/equipment/components/equipment-maintenance-form";
import { EquipmentMaintenanceLogList } from "@/features/equipment/components/equipment-maintenance-log-list";
import { EquipmentRentalForm } from "@/features/equipment/components/equipment-rental-form";
import { EquipmentRentalList } from "@/features/equipment/components/equipment-rental-list";
import { EquipmentTransactionTimeline } from "@/features/equipment/components/equipment-transaction-timeline";
import { equipmentRentalService } from "@/services/equipment/equipment-rental.service";
import { equipmentService } from "@/services/equipment/equipment.service";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";

interface EquipmentDetailPageProps {
  params: Promise<{ equipmentId: string }>;
}

export async function generateMetadata({ params }: EquipmentDetailPageProps): Promise<Metadata> {
  const { equipmentId } = await params;
  try {
    const equipment = await equipmentService.getEquipmentWithComputed(equipmentId);
    return { title: equipment.name };
  } catch {
    return { title: "Equipment" };
  }
}

export default async function EquipmentDetailPage({ params }: EquipmentDetailPageProps) {
  const { equipmentId } = await params;

  const equipment = await equipmentService.getEquipmentWithComputed(equipmentId).catch(() => null);
  if (!equipment) {
    notFound();
  }

  const [maintenanceLogs, timeline, rentals, players, paymentMethods] = await Promise.all([
    equipmentService.listMaintenanceLogs(equipmentId),
    equipmentService.getTransactionTimeline(equipmentId),
    equipmentRentalService.listRentals({ equipmentId }),
    playerService.listPlayers(),
    saleService.listPaymentMethods(),
  ]);

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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{equipment.name}</h1>
          <p className="text-muted-foreground text-sm">
            {equipment.availableQuantity} / {equipment.quantity} available
          </p>
        </div>
        <EquipmentConditionBadge condition={equipment.condition} />
      </div>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Details</h2>
          <EquipmentForm equipment={equipment} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Rent out</h2>
          <EquipmentRentalForm
            equipmentId={equipment.id}
            players={playerOptions}
            paymentMethods={paymentMethodOptions}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Rentals</h2>
        <EquipmentRentalList rentals={rentals} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Maintenance log</h2>
          <EquipmentMaintenanceLogList equipmentId={equipment.id} logs={maintenanceLogs} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Log entry / report damage</h2>
          <EquipmentMaintenanceForm equipmentId={equipment.id} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Transaction history</h2>
        <EquipmentTransactionTimeline events={timeline} />
      </section>
    </div>
  );
}
