import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";
import { settingsService } from "@/services/settings/settings.service";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

export const metadata: Metadata = {
  title: "Verify Open Play Payments",
};

// Gate 3 follow-up. A separate view from /dashboard/bookings/verify-
// payments on purpose (Gate 1's own recommendation, confirmed again
// here): that queue unconditionally joins booking.court/startAt, which
// has no equivalent on an OpenPlayNightRegistration — reusing it would
// mean either a fake join or a type discriminator threaded through
// every row, neither of which is "a quick reuse." Same visual language
// (table, Table/Badge primitives, relative-time + amount-mismatch
// treatment) as booking's own queue, its own screen.
export const dynamic = "force-dynamic";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export default async function OpenPlayVerifyPaymentsPage() {
  const [proofs, openPlaySettings] = await Promise.all([
    openPlayRegistrationPaymentProofService.listPendingProofs(),
    settingsService.getOpenPlaySettings(),
  ]);
  const now = Date.now();
  const expectedAmountCents = openPlaySettings.friSatRegistrationFeeCents;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify open-play payments</h1>
        <p className="text-muted-foreground text-sm">
          Every submitted GCash payment for an online open-play registration waits here until a staff
          member checks it against the GCash app. Oldest submissions first.
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
              <TableHead>Player</TableHead>
              <TableHead>Night</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proofs.map((proof) => {
              const elapsedMs = now - proof.submittedAt.getTime();
              const isOverThirtyMinutes = elapsedMs > THIRTY_MINUTES_MS;
              const amountMismatches = proof.submittedAmountCents !== expectedAmountCents;

              return (
                <TableRow key={proof.id} className={isOverThirtyMinutes ? "bg-destructive/5" : undefined}>
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
                      <span className="font-medium">{proof.registration.playerName}</span>
                      <span className="text-muted-foreground text-xs">
                        {proof.registration.phone} · {OPEN_PLAY_SKILL_LEVELS[proof.registration.skillLevel].label}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {proof.registration.date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}
                  </TableCell>
                  <TableCell>{formatCurrency(expectedAmountCents)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{formatCurrency(proof.submittedAmountCents)}</span>
                      {amountMismatches ? <Badge variant="warning">Mismatch</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/admin/open-play-capacity/verify-payments/${proof.id}`}
                      className="text-primary text-sm font-medium hover:underline"
                    >
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
