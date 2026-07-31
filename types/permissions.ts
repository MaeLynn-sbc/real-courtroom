// Permission keys used by seeded RolePermission grants and by lib/rbac.ts
// route checks. New permissions are added here and in prisma/seed.ts — the
// database rows are what actually govern access at runtime.

export const PERMISSIONS = {
  DASHBOARD_ACCESS: "dashboard:access",
  SYSTEM_ADMIN: "system:admin",
  USERS_MANAGE: "users:manage",
  COURTS_MANAGE: "courts:manage",
  BOOKINGS_MANAGE: "bookings:manage",
  // Phase 8 plumbing (BUILD-SPEC.md §8 addendum): deliberately separate
  // from BOOKINGS_MANAGE. Once the public-prepayment switch is on, staff
  // creating a booking from the dashboard may still use pay-at-venue —
  // but a role holding BOOKINGS_MANAGE (can create bookings) must not
  // automatically inherit that bypass. A future limited front-desk role
  // could hold BOOKINGS_MANAGE without this, and would have to collect
  // prepayment like the public site does. Not yet checked anywhere —
  // Gate 2 wires requireEmployee(PERMISSIONS.BOOKINGS_PAY_AT_VENUE, ...)
  // into the staff booking action's pay-at-venue payment-method options.
  BOOKINGS_PAY_AT_VENUE: "bookings:pay_at_venue",
  OPEN_PLAY_MANAGE: "open_play:manage",
  TOURNAMENTS_MANAGE: "tournaments:manage",
  PLAYERS_MANAGE: "players:manage",
  EQUIPMENT_MANAGE: "equipment:manage",
  REPORTS_MANAGE: "reports:manage",
  // v1.2 DRAFT (coaching sessions, Gate 1): a coach edits ONLY their own
  // availability windows — this permission gates "can reach the
  // endpoint at all," the service layer enforces the actual employeeId
  // match, same shape as every other "own X" scoping in this codebase.
  COACHING_MANAGE_OWN_AVAILABILITY: "coaching:manage_own_availability",
  // Rate-table edits (group size -> price, per coach) — owner-tier,
  // matching the existing precedent that CMS/rates-adjacent settings
  // gate on SYSTEM_ADMIN, not a narrower permission.
  COACHING_MANAGE_RATES: "coaching:manage_rates",
  // GCash reconciliation Gate 1 follow-up: deliberately its OWN,
  // narrower permission instead of reusing SYSTEM_ADMIN (the gate's
  // original, more conservative choice) — the owner asked for this
  // specifically assignable via the roles screen, granted to nobody by
  // default. Covers seeding the first-ever balance, confirming a day,
  // AND overriding a starting balance (the override is already reason-
  // required and audit-logged regardless of who does it, so it shares
  // this same permission rather than needing a second one).
  ACCOUNTS_CONFIRM_GCASH_RECONCILIATION: "accounts:confirm_gcash_reconciliation",
  // Expenses tracking Gate 1: its own dedicated, owner-assignable
  // permission (same shape as the GCash reconciliation gate's own
  // ACCOUNTS_CONFIRM_GCASH_RECONCILIATION, built the same session) —
  // granted to nobody by default, checkbox on the roles screen, the
  // owner assigns it themselves. Covers recording an expense AND
  // managing expense categories, same single-permission reasoning
  // (category management is a lightweight admin action alongside the
  // main expense-recording flow, not worth a second permission).
  ACCOUNTS_RECORD_EXPENSE: "accounts:record_expense",
  // Reported live: the Owner doesn't work a cash drawer, so requiring an
  // open Shift just to CREATE a booking (a no-money action — staff
  // bookings are created unpaid, see CreateBookingSaleContext's own
  // comment) is pointless friction that pushed staff toward
  // work-arounds. Same owner-assignable shape as the ACCOUNTS_* pair
  // above — granted to OWNER by default, nobody else, reassignable via
  // the Roles screen. Scoped to CREATION only: settleBooking (which
  // DOES move money) is untouched and still requires an open shift
  // unconditionally, regardless of who holds this permission.
  BOOKINGS_CREATE_WITHOUT_SHIFT: "bookings:create_without_shift",
  // Reported live: the TV display's operational settings (announcement
  // voice, repeat count, flash duration, refresh interval) were gated on
  // SYSTEM_ADMIN — OWNER/MANAGER only — but the person who actually needs
  // to change them is whoever's physically at the display, usually a
  // front-desk attendant. Voices in particular can only be tested and
  // chosen from the exact machine driving the TV, so owner-only meant
  // logging the attendant out first just to pick a voice. Its own
  // permission, not folded into an existing one — granted to OWNER,
  // MANAGER, and RECEPTIONIST by default (see prisma/seed.ts), reassignable
  // via the Roles screen like everything else. Deliberately NOT covering
  // regenerateDisplaySlug — the slug is the display's own auth token
  // (BUILD-SPEC.md §13), which stays SYSTEM_ADMIN-gated.
  DISPLAY_MANAGE: "display:manage",
  // Reported live: SaleCategory.OTHER existed in the schema (with
  // description/notes fields explicitly documented for "categories with
  // no source row") but nothing ever created one — cash that comes in
  // outside every modelled flow had nowhere to go, so staff recorded it
  // on paper instead, invisible to every report and shift reconciliation.
  // Its own dedicated permission, same reasoning as
  // ACCOUNTS_RECORD_EXPENSE/ACCOUNTS_CONFIRM_GCASH_RECONCILIATION right
  // above — an arbitrary-amount, no-linked-record entry is a trust
  // escape hatch, deliberately narrower than a general sales permission.
  // Granted to OWNER directly in prisma/seed.ts (same two-permissions-
  // learned-the-hard-way lesson those comments already document — OWNER
  // needs a self-service way in, not just "the owner assigns it from the
  // roles screen" with no way to reach that screen's grant in the first
  // place), absent from every other role by default.
  SALES_RECORD_MANUAL: "sales:record_manual",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
