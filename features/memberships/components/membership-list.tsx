import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MembershipStatusBadge } from "@/features/memberships/components/membership-status-badge";
import type { membershipService } from "@/services/memberships/membership.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

type Memberships = Awaited<ReturnType<typeof membershipService.listMemberships>>;

interface MembershipListProps {
  memberships: Memberships;
}

export function MembershipList({ memberships }: MembershipListProps) {
  if (memberships.length === 0) {
    return <p className="text-muted-foreground text-sm">No memberships found.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Player</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {memberships.map((membership) => (
          <TableRow key={membership.id}>
            <TableCell>
              <Link
                href={`/dashboard/memberships/${membership.id}`}
                className="font-medium hover:underline"
              >
                {membership.membershipReference}
              </Link>
            </TableCell>
            <TableCell>{membership.player.user.name ?? membership.player.user.email}</TableCell>
            <TableCell>{membership.membershipPlan.name}</TableCell>
            <TableCell>{dateFormatter.format(membership.endDate)}</TableCell>
            <TableCell>
              <MembershipStatusBadge status={membership.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
