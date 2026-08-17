import {
  Activity,
  BarChart3,
  Banknote,
  CalendarDays,
  CalendarRange,
  Clock,
  Coins,
  CreditCard,
  Dumbbell,
  FileText,
  Globe,
  GraduationCap,
  History,
  Landmark,
  LayoutDashboard,
  Lock,
  MapPin,
  Megaphone,
  MonitorPlay,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  Settings,
  TrendingDown,
  Trophy,
  Tv,
  UserCog,
  Users,
  Wallet,
  Receipt,
} from "lucide-react";

// ONE icon map for both dashboard navs.
//
// This used to be two near-identical copies — one in dashboard-sidebar.tsx
// (desktop), one in dashboard-header.tsx (the mobile drawer) — and they
// had already drifted: a fix adding the two Open Play icons landed only in
// the sidebar's copy, so on mobile those rows kept rendering with no icon
// and their labels sat unaligned against every other row's icon gutter.
// Reported again on 2026-08-17 from a phone screenshot, where Regular Open
// Play, Fri/Sat Open Play and Coaching were the visibly bare ones.
//
// A single exported map means the desktop and mobile navs cannot disagree
// again, and a new nav item is one edit rather than two.
export const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/shift": Clock,
  "/dashboard/admin/open-play-capacity/today": Sun,
  "/dashboard/admin/open-play-capacity": CalendarRange,
  "/dashboard/admin/openplayspecial": Tv,
  "/dashboard/courts": MapPin,
  "/dashboard/bookings": CalendarDays,
  "/dashboard/bookings/verify-payments": Receipt,
  "/dashboard/admin/open-play-capacity/verify-payments": Banknote,
  "/dashboard/coaching": GraduationCap,
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
  // Previously absent from BOTH maps, so these rendered bare everywhere.
  "/dashboard/admin/special-events": Sparkles,
  "/dashboard/payroll": Coins,
  "/dashboard/admin/tv-display": MonitorPlay,
  "/dashboard/sales": Store,
};
