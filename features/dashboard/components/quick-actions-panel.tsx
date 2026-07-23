import { CalendarPlus, Dumbbell, Lock, QrCode, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export function QuickActionsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="hover:border-primary/50 hover:bg-muted/30 flex flex-col items-center gap-2 rounded-xl border p-4 text-center text-sm font-medium transition-colors"
            >
              <action.icon className="text-muted-foreground size-5" aria-hidden="true" />
              {action.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <p className="text-muted-foreground text-xs">Browse</p>
          <div className="flex flex-wrap gap-2">
            {BROWSE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:bg-muted/50 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <link.icon className="size-3.5" aria-hidden="true" />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
