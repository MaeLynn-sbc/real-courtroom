"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { markCoachSessionCollectedAction } from "@/actions/coaching.actions";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

export interface UncollectedSession {
  id: string;
  sessionReference: string;
  playerName: string | null;
  bookingReference: string;
  startAt: string; // ISO — serialized for the client boundary
  rateCents: number;
}

const sessionDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Deliberately its own small two-button picker, not a reuse of
// SettlementPaymentFields — that component's built-in GCash reference
// field has nowhere real to go here (no gcashReference column exists on
// CoachSession or Sale; that field only ever lives on the Booking/
// PlayerTab a customer-facing settlement is for). Rendering it here would
// silently discard whatever staff typed into it — worse than not having
// it. This is an internal record correction ("mark this as collected"),
// not a payment-verification flow.
function SessionRow({
  session,
  paymentMethods,
}: {
  session: UncollectedSession;
  paymentMethods: SettlementPaymentMethodOption[];
}) {
  const router = useRouter();
  // Same root-cause fix as the settlement picker (2026-08-08): no default
  // selection, an attendant must actively choose.
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [isPending, startTransition] = useTransition();
  const selected = paymentMethods.find((method) => method.id === paymentMethodId);

  function handleMarkCollected() {
    startTransition(async () => {
      const result = await markCoachSessionCollectedAction({
        coachSessionId: session.id,
        paymentMethodId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${session.sessionReference} marked collected.`);
      router.refresh();
    });
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 pr-3">{session.sessionReference}</td>
      <td className="py-1.5 pr-3">{session.playerName ?? "—"}</td>
      <td className="py-1.5 pr-3">{session.bookingReference}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {sessionDateFormatter.format(new Date(session.startAt))}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(session.rateCents)}</td>
      <td className="py-1.5 pr-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1" role="group" aria-label="Payment method">
            {paymentMethods.map((method) => {
              const isSelected = method.id === paymentMethodId;
              return (
                <Button
                  key={method.id}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  aria-pressed={isSelected}
                  disabled={isPending}
                  onClick={() => setPaymentMethodId(method.id)}
                  className="font-bold uppercase"
                >
                  {method.label}
                </Button>
              );
            })}
          </div>
          {/* The one moment a wrong tap is visible before it commits —
              same discipline as the settlement picker's confirmation echo. */}
          {selected ? (
            <span className="text-muted-foreground text-xs">
              Marking {formatCurrency(session.rateCents)} as {selected.label.toUpperCase()}
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || !paymentMethodId}
          onClick={handleMarkCollected}
        >
          {isPending ? "Saving…" : "Mark collected"}
        </Button>
      </td>
    </tr>
  );
}

// Owner request (2026-08-09): "we should be the one to put the collected
// and... choose source of funds" — the mirror image of the report's main
// (already-paid) session table, for sessions with no Sale at all. Only
// rendered per coach when there's something to show — see
// coaching-weekly-report.tsx's own call site.
export function UncollectedCoachSessions({
  sessions,
  paymentMethods,
}: {
  sessions: UncollectedSession[];
  paymentMethods: SettlementPaymentMethodOption[];
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="border-warning/40 flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Not yet collected</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="py-1.5 pr-3 font-normal">Reference</th>
              <th className="py-1.5 pr-3 font-normal">Player</th>
              <th className="py-1.5 pr-3 font-normal">Booking</th>
              <th className="py-1.5 pr-3 font-normal">Start</th>
              <th className="py-1.5 pr-3 text-right font-normal">Fee</th>
              <th className="py-1.5 pr-3 font-normal">Payment method</th>
              <th className="py-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} paymentMethods={paymentMethods} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
