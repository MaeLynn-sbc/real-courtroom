import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { PracticeBill } from "@/services/open-play/practice.service";
import { skillTextClass } from "@/types/open-play-skill-color";

// Mock settle for practice (owner, 2026-09-17): each practice player's
// finished games as they would appear when settling a real tab — court,
// time, amount, total. Read-only on purpose: practice never takes money,
// so there is no payment button and nothing reaches sales.
export function PracticeBills({ bills }: { bills: PracticeBill[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice bills ({bills.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          What each practice player would pay when settling, at the regular game rate. Mock-up only
          — nothing here is charged or recorded as a sale.
        </p>
        {bills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No finished practice games yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {bills.map((bill) => (
              <div key={bill.registrationId} className="rounded-lg border px-3 py-2">
                <p className={`font-medium ${skillTextClass(bill.skillLevel)}`}>
                  {bill.playerName}
                </p>
                <ul
                  className="mt-1 flex flex-col gap-1 text-sm"
                  aria-label={`${bill.playerName}'s practice charges`}
                >
                  {bill.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span>{item.description}</span>
                      <span className="tabular-nums">{formatCurrency(item.amountCents)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 border-t pt-1 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(bill.totalCents)}</span>
                  </li>
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
