"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { returnLockerRentalAction } from "@/actions/locker.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LockerRentalStatusBadge } from "@/features/lockers/components/locker-rental-status-badge";
import type { lockerRentalService } from "@/services/lockers/locker-rental.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

type Rentals = Awaited<ReturnType<typeof lockerRentalService.listRentals>>;

interface LockerRentalListProps {
  rentals: Rentals;
  showLockerColumn?: boolean;
}

export function LockerRentalList({ rentals, showLockerColumn = false }: LockerRentalListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleEnd(rentalId: string, lockerId: string) {
    startTransition(async () => {
      const result = await returnLockerRentalAction(rentalId, lockerId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (rentals.length === 0) {
    return <EmptyState title="No rentals yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          {showLockerColumn ? <TableHead>Locker</TableHead> : null}
          <TableHead>Player</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rentals.map((rental) => (
          <TableRow key={rental.id}>
            <TableCell>
              <Link
                href={`/dashboard/lockers/rentals/${rental.id}`}
                className="font-medium hover:underline"
              >
                {rental.rentalReference}
              </Link>
            </TableCell>
            {showLockerColumn ? <TableCell>{rental.locker.code}</TableCell> : null}
            <TableCell>{rental.player.user.name ?? rental.player.user.email}</TableCell>
            <TableCell>{dateFormatter.format(rental.endAt)}</TableCell>
            <TableCell>
              <LockerRentalStatusBadge status={rental.status} />
            </TableCell>
            <TableCell>
              {rental.status === "ACTIVE" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleEnd(rental.id, rental.lockerId)}
                >
                  End rental
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
