import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EquipmentRentalList } from "@/features/equipment/components/equipment-rental-list";
import { equipmentRentalService } from "@/services/equipment/equipment-rental.service";

interface EquipmentRentalDetailPageProps {
  params: Promise<{ rentalId: string }>;
}

export async function generateMetadata({ params }: EquipmentRentalDetailPageProps): Promise<Metadata> {
  const { rentalId } = await params;
  const rental = await equipmentRentalService.getRentalById(rentalId);
  return { title: rental?.rentalReference ?? "Equipment Rental" };
}

export default async function EquipmentRentalDetailPage({ params }: EquipmentRentalDetailPageProps) {
  const { rentalId } = await params;

  const rental = await equipmentRentalService.getRentalById(rentalId);
  if (!rental) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{rental.rentalReference}</h1>
        <p className="text-muted-foreground text-sm">
          <Link href={`/dashboard/equipment/${rental.equipmentId}`} className="hover:underline">
            {rental.equipment.name}
          </Link>
          {" · "}
          {rental.player.user.name ?? rental.player.user.email}
        </p>
      </div>

      <EquipmentRentalList rentals={[rental]} />
    </div>
  );
}
