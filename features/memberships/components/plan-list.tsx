import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { membershipService } from "@/services/memberships/membership.service";

const BILLING_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

function formatCents(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

type Plans = Awaited<ReturnType<typeof membershipService.listPlans>>;

interface PlanListProps {
  plans: Plans;
}

export function PlanList({ plans }: PlanListProps) {
  if (plans.length === 0) {
    return <EmptyState title="No membership plans yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Billing</TableHead>
          <TableHead>Discount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {plans.map((plan) => (
          <TableRow key={plan.id}>
            <TableCell className="font-medium">{plan.name}</TableCell>
            <TableCell>{formatCents(plan.priceCents)}</TableCell>
            <TableCell>{BILLING_LABELS[plan.billingPeriod] ?? plan.billingPeriod}</TableCell>
            <TableCell>{plan.discountPercent ? `${plan.discountPercent}%` : "—"}</TableCell>
            <TableCell>
              {/* BUILD-SPEC.md §2 — genuine live "is this plan active"
                  status, sitting directly beneath the page's green "New
                  plan" button (app/dashboard/memberships/plans/page.tsx).
                  variant="status" avoids the same green meaning two
                  different things on one screen — same fix as the other
                  status-table cases in the 13-screen batch (category-list,
                  registration-roster-panel, shift-workspace). Found
                  during that batch, fixed as its own follow-up per plan-
                  form.tsx (a create form, not this list) being what was
                  actually flagged. */}
              <Badge variant={plan.isActive ? "status" : "outline"}>
                {plan.isActive ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
