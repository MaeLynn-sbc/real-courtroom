import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CourtStatusBadge } from "@/features/courts/components/court-status-badge";
import type { Court } from "@/lib/generated/prisma/client";
import { formatCurrency } from "@/lib/utils";

interface CourtListProps {
  courts: Court[];
}

export function CourtList({ courts }: CourtListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Hourly rate</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {courts.map((court) => (
          <TableRow key={court.id}>
            <TableCell>
              <Link href={`/dashboard/courts/${court.id}`} className="font-medium hover:underline">
                {court.name}
              </Link>
            </TableCell>
            <TableCell>{court.indoor ? "Indoor" : "Outdoor"}</TableCell>
            <TableCell>
              {court.hourlyRateCents != null ? formatCurrency(court.hourlyRateCents) : "—"}
            </TableCell>
            <TableCell>
              <CourtStatusBadge status={court.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
