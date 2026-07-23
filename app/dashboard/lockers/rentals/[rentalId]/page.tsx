import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LockerRentalList } from "@/features/lockers/components/locker-rental-list";
import { lockerRentalService } from "@/services/lockers/locker-rental.service";

interface LockerRentalDetailPageProps {
  params: Promise<{ rentalId: string }>;
}

export async function generateMetadata({ params }: LockerRentalDetailPageProps): Promise<Metadata> {
  const { rentalId } = await params;
  const rental = await lockerRentalService.getRentalById(rentalId);
  return { title: rental?.rentalReference ?? "Locker Rental" };
}

export default async function LockerRentalDetailPage({ params }: LockerRentalDetailPageProps) {
  const { rentalId } = await params;

  const rental = await lockerRentalService.getRentalById(rentalId);
  if (!rental) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{rental.rentalReference}</h1>
        <p className="text-muted-foreground text-sm">
          <Link href={`/dashboard/lockers/${rental.lockerId}`} className="hover:underline">
            {rental.locker.code}
          </Link>
          {" · "}
          {rental.player.user.name ?? rental.player.user.email}
        </p>
      </div>

      <LockerRentalList rentals={[rental]} />
    </div>
  );
}
