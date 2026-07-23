import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LockerStatusBadge } from "@/features/lockers/components/locker-status-badge";
import type { lockerService } from "@/services/lockers/locker.service";

type Lockers = Awaited<ReturnType<typeof lockerService.listLockers>>;

interface LockerListProps {
  lockers: Lockers;
}

export function LockerList({ lockers }: LockerListProps) {
  if (lockers.length === 0) {
    return <EmptyState title="No lockers yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lockers.map((locker) => (
          <TableRow key={locker.id}>
            <TableCell>
              <Link href={`/dashboard/lockers/${locker.id}`} className="font-medium hover:underline">
                {locker.code}
              </Link>
            </TableCell>
            <TableCell>
              <LockerStatusBadge status={locker.displayStatus} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
