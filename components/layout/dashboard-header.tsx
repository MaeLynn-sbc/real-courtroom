"use client";

import {
  Activity,
  BarChart3,
  Banknote,
  CalendarDays,
  Clock,
  CreditCard,
  Dumbbell,
  FileText,
  Globe,
  History,
  Landmark,
  LayoutDashboard,
  Lock,
  MapPin,
  Megaphone,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  TrendingDown,
  Trophy,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { UserNav } from "@/components/layout/user-nav";
import { Logo } from "@/components/shared/logo";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { dashboardNavGroups, siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/shift": Clock,
  "/dashboard/courts": MapPin,
  "/dashboard/bookings": CalendarDays,
  "/dashboard/bookings/verify-payments": Receipt,
  "/dashboard/admin/open-play-capacity/verify-payments": Banknote,
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
  "/dashboard/admin/expenses": TrendingDown,
  "/dashboard/admin/products": ShoppingBag,
  "/dashboard/admin/website": Globe,
  "/dashboard/admin/audit-logs": History,
  "/dashboard/admin/settings": Settings,
  "/dashboard/admin/diagnostics": Activity,
  "/dashboard/admin/gcash-reconciliation": Landmark,
};

interface DashboardHeaderProps {
  pendingVerificationCount: number;
  pendingOpenPlayVerificationCount: number;
}

export function DashboardHeader({ pendingVerificationCount, pendingOpenPlayVerificationCount }: DashboardHeaderProps) {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 flex h-16 items-center gap-3 border-b px-4 backdrop-blur-md md:px-6">
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          }
        />
        <SheetContent side="left" className="w-64 overflow-y-auto">
          <SheetHeader className="flex-row items-center gap-2">
            <Logo size="sm" />
            <SheetTitle>{siteConfig.name}</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-4 p-3">
            {dashboardNavGroups.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <h2 className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                  {group.label}
                </h2>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.href];

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
                    >
                      {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
                      {item.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
        <Logo size="sm" />
        <span className="text-sm font-semibold tracking-tight">{siteConfig.name}</span>
      </Link>

      <div className="ml-auto flex items-center gap-3">
        {pendingVerificationCount > 0 ? (
          <Link
            href="/dashboard/bookings/verify-payments"
            aria-label={`${pendingVerificationCount} payment ${pendingVerificationCount === 1 ? "verification" : "verifications"} pending`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
          >
            <Receipt className="size-5" aria-hidden="true" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full px-1 text-[10px]"
            >
              {pendingVerificationCount > 9 ? "9+" : pendingVerificationCount}
            </Badge>
          </Link>
        ) : null}
        {pendingOpenPlayVerificationCount > 0 ? (
          <Link
            href="/dashboard/admin/open-play-capacity/verify-payments"
            aria-label={`${pendingOpenPlayVerificationCount} open-play payment ${pendingOpenPlayVerificationCount === 1 ? "verification" : "verifications"} pending`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
          >
            <Banknote className="size-5" aria-hidden="true" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full px-1 text-[10px]"
            >
              {pendingOpenPlayVerificationCount > 9 ? "9+" : pendingOpenPlayVerificationCount}
            </Badge>
          </Link>
        ) : null}
        <NotificationBell />
        <UserNav />
      </div>
    </header>
  );
}
