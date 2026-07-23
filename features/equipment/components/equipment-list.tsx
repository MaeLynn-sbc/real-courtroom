import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EquipmentConditionBadge } from "@/features/equipment/components/equipment-condition-badge";
import type { equipmentService } from "@/services/equipment/equipment.service";

const TYPE_LABELS: Record<string, string> = {
  PADDLE: "Paddle",
  BALL: "Ball",
  BALL_MACHINE: "Ball Machine",
};

type Items = Awaited<ReturnType<typeof equipmentService.listEquipment>>;

interface EquipmentListProps {
  items: Items;
}

export function EquipmentList({ items }: EquipmentListProps) {
  if (items.length === 0) {
    return <EmptyState title="No equipment yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Available</TableHead>
          <TableHead>Condition</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Link href={`/dashboard/equipment/${item.id}`} className="font-medium hover:underline">
                {item.name}
              </Link>
            </TableCell>
            <TableCell>{TYPE_LABELS[item.type] ?? item.type}</TableCell>
            <TableCell>
              {item.availableQuantity} / {item.quantity}
            </TableCell>
            <TableCell>
              <EquipmentConditionBadge condition={item.condition} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
