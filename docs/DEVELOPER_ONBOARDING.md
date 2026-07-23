# Developer Onboarding

Start with [ARCHITECTURE.md](../ARCHITECTURE.md) — it is the single source
of truth for this project's structure and decisions, and every phase's
addendum in it is frozen (changing a documented decision requires
explaining why first). This doc is a shorter, task-oriented companion: it
tells you where to look for a given kind of change, and names the recurring
patterns so you don't have to rediscover them from scratch.

## Local setup

See [INSTALLATION.md](./INSTALLATION.md).

## Layering

```
app/          → pages (Server Components by default), route handlers
components/   → shared, presentation-only UI (ui/ = design-system primitives, shared/ = app-specific reusable pieces)
features/     → per-module client components, forms, Zod schemas
services/     → business logic, all Prisma access
actions/      → Server Actions — thin: auth check → Zod parse → call a service → format the result
lib/          → cross-cutting utilities (env, logger, prisma client, rbac, rate-limit, errors, action-auth)
prisma/       → schema, migrations, seed
e2e/          → Playwright specs
```

**The rule that matters most**: business logic lives in `services/`, never
in a component or a page. Components never call Prisma or a service
directly — only through a Server Action. If you're adding a mutation and
find yourself importing `@/lib/prisma` into a `"use client"` file, stop —
that file (or something it imports) will crash in the browser, since
`lib/prisma.ts`/`lib/env.ts` are Node-only.

## Every Server Action follows the same shape

```ts
export async function someAction(input: SomeInput): Promise<SomeActionState> {
  const authz = await requirePermission(PERMISSIONS.SOME_MANAGE, "You don't have permission to ...");
  if (!authz.ok) return { error: authz.error };

  const parsed = someSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const result = await someService.doThing(parsed.data, authz.userId);
    revalidatePath("/dashboard/some-section");
    return { error: null, result };
  } catch (error) {
    return { error: toActionError(error, { action: "someAction", userId: authz.userId }) };
  }
}
```

`lib/action-auth.ts` (`requireSession`/`requirePermission`/
`requireSystemAdmin`) and `lib/errors.ts` (`toActionError`) exist
specifically so every action follows this exact shape without re-deriving
it — see every file in `actions/` for real examples, and the Phase 10
ARCHITECTURE.md addendum for why these were extracted.

## Patterns you'll see reused across every module

- **Computed, not stored.** Anything derivable from other rows (equipment
  condition, locker status, court availability, player statistics, a
  membership's expiration) is computed on read, never written to a stored
  "status" column that could drift out of sync. Look at
  `services/equipment/equipment-condition.ts` or
  `services/lockers/locker-status.ts` for the shape: a pure function, unit
  tested directly, no Prisma import.
- **Lazy reconciliation instead of a cron job.** This app has no
  scheduler. Anything that "should happen automatically over time"
  (memberships expiring, rentals going overdue, notifications generating)
  is instead checked-and-fixed at the top of the relevant read path — see
  `membershipService.reconcileExpiredMemberships`,
  `equipmentRentalService.reconcileOverdueRentals`,
  `notificationService.generateReminders()`.
- **Human-friendly reference codes.** `Booking.bookingReference`
  (`BK-YYYYMMDD-NNNN`), `Membership.membershipReference`
  (`MB-...`), `EquipmentRental`/`LockerRental.rentalReference`
  (`ER-.../LR-...`) — all generated the same way: a pure formatter
  function plus a same-day-count-then-retry-on-collision loop inside the
  service method. Follow this exact pattern if a future module needs one.
- **Serializable transactions for check-then-write races.** Anywhere a
  service reads availability/capacity and then writes based on that read
  (booking a court, renting a locker/equipment unit, advancing a
  tournament bracket), the check and the write are wrapped in
  `prisma.$transaction(fn, { isolationLevel: "Serializable" })`, with a
  `P2034`-catching retry loop. See `booking.service.ts`'s `createBooking`
  for the reference implementation, and the Phase 10 ARCHITECTURE.md
  addendum for the full list and reasoning.
- **Derived timelines instead of a fourth activity log.** Player, Equipment,
  and Locker detail pages all show a merged chronological feed built by
  combining existing records (bookings + registrations + rentals, or
  rentals + maintenance logs) in memory — see
  `services/player/player-timeline.ts` for the pattern. The
  cross-module Activity Feed (Reports/Notifications module) instead reuses
  `AuditLog` directly rather than adding a fifth version of this.

## RBAC

Database-backed, not an enum. `Role`/`Permission`/`RolePermission` are real
tables; `types/permissions.ts`'s `PERMISSIONS` object is just typed
constants for the fixed *permission* catalog, not the source of truth for
who has what (that's the `Role`/`RolePermission` rows themselves,
seeded initially by `prisma/seed.ts`'s `ROLE_PERMISSION_GRANTS`). As of
v1.1, roles themselves are no longer fixed either — the Roles workspace
(`/dashboard/admin/roles`, gated by `PERMISSIONS.USERS_MANAGE`) lets an
Owner create arbitrary new roles and choose which of the fixed permissions
each one grants, entirely from the database, no code change. `types/roles.ts`'s
`SYSTEM_ROLES` still exists as a typed pointer to the roles seeded out of
the box (some code paths, like Player creation, still look up a role by
that stable key) — it is not an exhaustive list of every role that can
exist. `session.user.role` is typed as a plain `string`, not a
`SystemRoleName` union, for exactly this reason.

Permissions are embedded in the session JWT at sign-in — a database
permission or role change takes effect on the affected user's next login,
not instantly. `lib/rbac.ts`'s `PROTECTED_ROUTES` maps a URL prefix to a
required permission using longest-prefix-match, so a more specific rule
(e.g. `/dashboard/admin/employees`) can require a stricter permission than
its parent (`/dashboard/admin`) regardless of array order. See the Phase
10 ARCHITECTURE.md addendum's RBAC Audit appendix for the pre-v1.1
mapping of every route and every Server Action to its required
permission, and the v1.1 addendum for what changed on top of it.

## Testing

- **Unit tests (Jest)** live next to the code they test (`*.test.ts`),
  mostly targeting the pure `services/*/xxx-yyy.ts` calculation modules
  (bracket generation, status machines, condition/availability
  calculators) — these have no Prisma dependency, so they're fast and
  don't need a database.
- **E2E tests (Playwright)**, in `e2e/`, require a seeded database and a
  running server. `npx playwright test` reuses an already-running dev
  server or starts one; set `PW_PROD_SERVER=1` to run against a production
  build instead. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for the
  documented full-suite-load flakiness category and how to interpret it
  before assuming a real regression.
- Before trusting any UI change actually works, verify it live (start the
  dev server, click through it, or drive it with a throwaway Playwright
  script) — this codebase has a real history of changes that typecheck,
  lint, and build cleanly while being broken in the browser (see
  ARCHITECTURE.md's Phase 3, 4, and 9 addenda for specific examples).
  Typecheck/lint/build/unit-tests verify code correctness, not feature
  correctness.

## Where to look next

- Adding a new module: read the addendum for the most structurally-similar
  existing module first (Phase 3 for a simple CRUD service, Phase 5 for a
  multi-service orchestration pattern, Phase 9 for a cross-module reader).
- Touching auth/permissions: Phase 1 addendum + the Phase 10 RBAC Audit.
- Touching anything performance/reliability-sensitive: the Phase 10
  addendum's batching and Serializable-transaction sections.
- Confused by a Base UI component behaving oddly: check Phase 9's gotcha
  #19 first — a shared UI primitive has had a real, silent bug before.
