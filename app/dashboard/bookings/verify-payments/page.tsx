import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getExpectedPaymentTotalCents } from "@/lib/booking-payment-total";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";

export const metadata: Metadata = {
  title: "Verify Payments",
};

// Phase 8 Gate 3 (BUILD-SPEC.md §8 "Verification queue"). Not a static
// page — every online booking now blocks on staff once the prepayment
// switch is on, so this can't statically prerender a snapshot of
// pending proofs.
export const dynamic = "force-dynamic";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export default async function VerifyPaymentsPage() {
  const proofs = await bookingPaymentProofService.listPendingProofs();
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify payments</h1>
        <p className="text-muted-foreground text-sm">
          Every submitted GCash payment waits here until a staff member checks it against the
          GCash app. Oldest submissions first — the ones waiting longest need attention first.
        </p>
      </div>

      {proofs.length === 0 ? (
        <EmptyState
          title="Nothing waiting on verification."
          description="Submitted GCash payments will show up here, oldest first."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waiting</TableHead>
              <TableHead>Court &amp; time</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proofs.map((proof) => {
              const elapsedMs = now - proof.submittedAt.getTime();
              const isOverThirtyMinutes = elapsedMs > THIRTY_MINUTES_MS;
              const expectedAmountCents = getExpectedPaymentTotalCents(proof.booking);
              const amountMismatches = proof.submittedAmountCents !== expectedAmountCents;

              return (
                <TableRow
                  key={proof.id}
                  className={isOverThirtyMinutes ? "bg-destructive/5" : undefined}
                >
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className={isOverThirtyMinutes ? "text-destructive font-medium" : undefined}>
                        {formatRelativeTime(proof.submittedAt)}
                      </span>
                      {isOverThirtyMinutes ? (
                        <Badge variant="destructive" className="w-fit">
                          Over 30 min
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{proof.booking.court.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {proof.booking.startAt.toLocaleString("en-PH", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{proof.booking.guestName ?? "—"}</TableCell>
                  <TableCell>{formatCurrency(expectedAmountCents)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{formatCurrency(proof.submittedAmountCents)}</span>
                      {amountMismatches ? <Badge variant="warning">Mismatch</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/bookings/verify-payments/${proof.id}`} className="text-primary text-sm font-medium hover:underline">
                      Review
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
