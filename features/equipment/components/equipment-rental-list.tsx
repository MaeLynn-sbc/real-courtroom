"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { markEquipmentLostAction, returnEquipmentRentalAction } from "@/actions/equipment.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EquipmentRentalStatusBadge } from "@/features/equipment/components/equipment-rental-status-badge";
import type { equipmentRentalService } from "@/services/equipment/equipment-rental.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

type Rentals = Awaited<ReturnType<typeof equipmentRentalService.listRentals>>;

interface EquipmentRentalListProps {
  rentals: Rentals;
  showEquipmentColumn?: boolean;
}

export function EquipmentRentalList({ rentals, showEquipmentColumn = false }: EquipmentRentalListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleAction(action: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const result = await action();
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
          {showEquipmentColumn ? <TableHead>Equipment</TableHead> : null}
          <TableHead>Player</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rentals.map((rental) => (
          <TableRow key={rental.id}>
            <TableCell>
              <Link
                href={`/dashboard/equipment/rentals/${rental.id}`}
                className="font-medium hover:underline"
              >
                {rental.rentalReference}
              </Link>
            </TableCell>
            {showEquipmentColumn ? <TableCell>{rental.equipment.name}</TableCell> : null}
            <TableCell>{rental.player.user.name ?? rental.player.user.email}</TableCell>
            <TableCell>{rental.dueAt ? dateFormatter.format(rental.dueAt) : "—"}</TableCell>
            <TableCell>
              <EquipmentRentalStatusBadge status={rental.status} />
            </TableCell>
            <TableCell>
              {rental.status === "ACTIVE" || rental.status === "OVERDUE" ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      handleAction(() => returnEquipmentRentalAction(rental.id, rental.equipmentId))
                    }
                  >
                    Return
                  </Button>
                  <ConfirmActionButton
                    title="Mark this rental as lost?"
                    description="This flags the equipment as lost — use this only when the item won't be returned."
                    confirmLabel="Mark lost"
                    disabled={isPending}
                    onConfirm={() =>
                      handleAction(() => markEquipmentLostAction(rental.id, rental.equipmentId))
                    }
                  >
                    Mark lost
                  </ConfirmActionButton>
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
