import { CalendarPlus, Dumbbell, Lock, QrCode, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Only New Booking / Check-In are genuine one-click quick actions — every
// other operation (renting a specific item, registering for a specific
// tournament category, enrolling a specific player) requires picking an
// entity first, since no picker-first quick-entry page exists yet for
// those. The Browse row links to where that picking happens today rather
// than overselling this as a full inline quick-action redesign.
const QUICK_ACTIONS = [
  { href: "/dashboard/bookings/new", label: "New booking", icon: CalendarPlus },
  { href: "/dashboard/bookings/check-in", label: "Check in", icon: QrCode },
];

const BROWSE_LINKS = [
  { href: "/dashboard/equipment", label: "Equipment", icon: Dumbbell },
  { href: "/dashboard/lockers", label: "Lockers", icon: Lock },
  { href: "/dashboard/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/dashboard/players", label: "Players & memberships", icon: Users },
];

/** Presentation only — same two actions, same four browse links, same
 * hrefs. The two primary tiles were tall bordered boxes with a muted
 * icon floating above centred text: visually the heaviest thing in the
 * card, while reading as inert placeholders rather than buttons. They
 * are now proper action rows — filled for the primary, outlined for the
 * secondary — matching the same two links in the page header so the
 * duplication at least looks intentional instead of accidental. */
export function QuickActionsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUICK_ACTIONS.map((action, index) => (
            <Link
              key={action.href}
              href={action.href}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
                index === 0
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "border-border hover:bg-muted/40 border",
              )}
            >
              <action.icon className="size-4 shrink-0" aria-hidden="true" />
              {action.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-muted-foreground text-[10px] font-bold tracking-[0.12em] uppercase">
            Browse
          </p>
          <div className="flex flex-wrap gap-2">
            {BROWSE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:bg-muted/50 hover:border-primary/40 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <link.icon className="text-muted-foreground size-3.5" aria-hidden="true" />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
