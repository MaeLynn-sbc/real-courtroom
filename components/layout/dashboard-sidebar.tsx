"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock,
  CreditCard,
  Dumbbell,
  FileText,
  Globe,
  History,
  LayoutDashboard,
  Lock,
  MapPin,
  Megaphone,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/shared/logo";
import { dashboardNavGroups, dashboardNavItems } from "@/lib/config";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/shift": Clock,
  "/dashboard/courts": MapPin,
  "/dashboard/bookings": CalendarDays,
  "/dashboard/bookings/verify-payments": Receipt,
  "/dashboard/open-play": Repeat,
  "/dashboard/tournaments": Trophy,
  "/dashboard/players": Users,
  "/dashboard/memberships": CreditCard,
  "/dashboard/equipment": Dumbbell,
  "/dashboard/lockers": Lock,
  "/dashboard/products": ShoppingBag,
  "/dashboard/reports": FileText,
  "/dashboard/analytics": BarChart3,
  "/dashboard/announcements": Megaphone,
  "/dashboard/admin/employees": UserCog,
  "/dashboard/admin/roles": ShieldCheck,
  "/dashboard/admin/payment-methods": Wallet,
  "/dashboard/admin/products": ShoppingBag,
  "/dashboard/admin/website": Globe,
  "/dashboard/admin/audit-logs": History,
  "/dashboard/admin/settings": Settings,
  "/dashboard/admin/diagnostics": Activity,
};

// Picks the longest href that matches the current path (exact or as a
// parent segment), so a nested route like /dashboard/courts/abc123
// highlights "Courts" without also highlighting "Dashboard".
function getActiveHref(pathname: string, hrefs: readonly string[]): string | undefined {
  const matches = hrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`));

  if (matches.length === 0) {
    return undefined;
  }

  return matches.reduce((longest, href) => (href.length > longest.length ? href : longest));
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const activeHref = getActiveHref(
    pathname,
    dashboardNavItems.map((item) => item.href),
  );

  return (
    <aside className="border-border/60 bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 border-r md:flex md:flex-col md:overflow-y-auto">
      <div className="border-sidebar-border/60 flex h-16 items-center border-b px-4">
        <Link href="/dashboard" className="flex items-center">
          <Logo size="sm" showWordmark />
        </Link>
      </div>
      <nav className="flex flex-col gap-4 p-3">
        {dashboardNavGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h2 className="text-sidebar-foreground/60 px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </h2>
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.href];
              const isActive = item.href === activeHref;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
                  {item.title}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
