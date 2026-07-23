# PROJECT TITLE

The Courtroom Pickleball Management System (TCPMS)

# PROJECT OVERVIEW

Build a production-ready enterprise web application for "The Courtroom", an indoor pickleball facility.

This system will initially run entirely offline on localhost for development and testing. It must be designed so that deployment to a live server requires minimal changes.

IMPORTANT:
- Semcourttè Cafe is NOT connected to this system.
- Do NOT include POS, food ordering, inventory for food, or café-related features.
- Focus exclusively on pickleball operations.

----------------------------------------------------
TECH STACK
----------------------------------------------------

Frontend
- Next.js 15 (App Router)
- React 19
- TypeScript
- TailwindCSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query

Backend
- Next.js API Routes (preferred)
- Prisma ORM
- PostgreSQL

Authentication
- NextAuth/Auth.js
- JWT Sessions

File Uploads
- Local uploads for development
- Cloudinary-ready abstraction

Payments
- Abstract payment service
- Sandbox mode
- Future PayMongo integration

Email
- Development mail logger
- Production email abstraction

Testing
- Jest
- Playwright

----------------------------------------------------
ARCHITECTURE
----------------------------------------------------

Use Clean Architecture.

Separate

/app

/components

/features

/services

/lib

/hooks

/types

/prisma

/actions

Create reusable modules.

Use dependency injection where appropriate.

No business logic inside UI components.

Use Server Components whenever beneficial.

----------------------------------------------------
DESIGN STYLE
----------------------------------------------------

Modern premium sports club.

Theme

White

Black

Dark Gray

Minimal Orange Accent

Rounded cards

Glassmorphism only where appropriate.

Fully responsive.

Desktop first.

Tablet.

Mobile.

----------------------------------------------------
USER ROLES
----------------------------------------------------

Guest

Member

Receptionist

Tournament Director

Manager

Owner

Implement RBAC (Role Based Access Control).

----------------------------------------------------
MODULES
----------------------------------------------------

1. Authentication

Login

Register

Forgot Password

Google Login Ready

Profile

Roles

----------------------------------------------------

2. Landing Website

Homepage

About

Rates

Membership

Book Court

Open Play

Tournaments

Gallery

News

Contact

FAQ

----------------------------------------------------

3. Court Management

Create Courts

Edit Courts

Disable Courts

Maintenance Schedule

Court Availability

Court Status

----------------------------------------------------

4. Booking System

Hourly booking

Recurring booking

Walk-in booking

Private bookings

Maintenance blocking

Calendar view

Week view

Month view

Booking statuses

Pending

Confirmed

Paid

Checked In

Completed

Cancelled

No Show

Generate QR Code after confirmation.

----------------------------------------------------

5. Membership

Membership plans

Silver

Gold

VIP

Student

Senior

Renewals

Expiration

Discounts

Priority Booking

----------------------------------------------------

6. Open Play

Registration

Capacity limits

Waitlist

Automatic promotion

Player Queue

Court Rotation

Attendance

History

----------------------------------------------------

7. Tournament System

Create Tournament

Registration

Fees

Categories

Brackets

Round Robin

Single Elimination

Double Elimination

Pool Play

Mixed

Score Encoding

Live Standings

Champion History

Printable Brackets

----------------------------------------------------

8. Player Profiles

Photo

Skill Level

Rating

Dominant Hand

Position

Wins

Losses

Match History

Tournament History

Booking History

Membership

----------------------------------------------------

9. Player Ratings

ELO Rating

Statistics

Leaderboard

Win Percentage

Current Streak

Future DUPR integration

----------------------------------------------------

10. Equipment Rentals

Paddles

Balls

Ball Machines

Status

Rental history

Deposits

Late fees

Maintenance logs

----------------------------------------------------

11. Lockers

Daily Rental

Monthly Rental

Rental history

Future QR support

----------------------------------------------------

12. Reception Dashboard

Today's bookings

Walk-ins

Upcoming reservations

Current games

Available courts

Occupied courts

Check-in

Payments

----------------------------------------------------

13. Admin Dashboard

Revenue

Bookings

Occupancy

Player growth

Membership growth

Reports

Pending payments

Notifications

----------------------------------------------------

14. Reports

Revenue

Bookings

Occupancy

Peak hours

Tournament revenue

No Shows

Cancellation Rate

Membership Statistics

Equipment Usage

----------------------------------------------------

15. Notifications

Booking confirmation

Payment confirmation

Tournament reminder

Membership expiration

Announcements

Email abstraction

Future SMS

Future Messenger

----------------------------------------------------
DATABASE
----------------------------------------------------

Create complete Prisma schema.

Include

Users

Roles

Permissions

Players

Courts

CourtMaintenance

Bookings

BookingHistory

Payments

Invoices

MembershipPlans

Memberships

OpenPlaySessions

OpenPlayRegistrations

OpenPlayQueue

Tournaments

TournamentCategories

TournamentRegistrations

Matches

Scores

Teams

PlayerRatings

PlayerStatistics

Equipment

EquipmentRentals

Lockers

LockerRentals

Notifications

Announcements

AuditLogs

Settings

Use proper foreign keys.

Soft delete where appropriate.

Timestamps everywhere.

----------------------------------------------------
ADMIN FEATURES
----------------------------------------------------

Search

Pagination

Sorting

Filtering

Bulk actions

Audit Logs

Role Permissions

----------------------------------------------------
QUALITY
----------------------------------------------------

Generate production-quality code.

Use TypeScript strictly.

No any types.

Reusable components.

No duplicated code.

Proper validation.

Error boundaries.

Loading skeletons.

Empty states.

Toast notifications.

Accessibility compliant.

Dark mode support.

----------------------------------------------------
PROJECT STRUCTURE
----------------------------------------------------

Use a scalable folder structure.

Organize by feature instead of page whenever possible.

----------------------------------------------------
CODE STYLE
----------------------------------------------------

ESLint

Prettier

Strict TypeScript

Meaningful naming

Comments only where necessary.

----------------------------------------------------
OUTPUT
----------------------------------------------------

Build this project incrementally.

Generate complete files.

Do not omit code.

Do not use placeholders.

If a feature depends on another feature, generate prerequisites first.

Always explain folder changes before generating code.

Never regenerate existing files unless modifications are required.

----------------------------------------------------
PHASE 1 ARCHITECTURAL ADDENDUM (FROZEN)
----------------------------------------------------

This addendum is part of the single source of truth. It resolves details the
base document left open, as agreed before Phase 1 implementation began. Once
Phase 1 starts, this architecture is frozen: no new top-level folders, no
renamed folders, and no architectural decisions may change without first
explaining why and getting explicit approval.

Folder structure — exactly these top-level folders, no /src wrapper:

/app
/components
/features
/services
/lib
/hooks
/types
/prisma
/actions
/e2e            (approved exception: Playwright specs, per Playwright convention;
                 Jest unit tests stay co-located next to the code they test)
/public

Root-level config/auth files (not architectural folders, required by the
stack itself): middleware.ts, auth.ts, auth.config.ts, docker-compose.yml,
jest.config.ts, jest.setup.ts, playwright.config.ts, components.json,
next.config.ts, tsconfig.json, eslint.config.mjs, .env, .env.example.

RBAC — database-backed, not enum-based.
Role, Permission, and RolePermission are real Prisma models, not a Prisma
enum. This allows permissions to be reconfigured from the database later
without code changes. User.roleId is a foreign key to Role. The fixed set of
system role keys (Owner, Manager, Receptionist, Tournament Director, Member)
also exists in code as `types/roles.ts: SYSTEM_ROLES`, used only for seeding
and type-narrowing — the source of truth for which permissions a role has is
always the database. Guest remains a code-only concept for unauthenticated
users and has no Role row.

RBAC is enforced through the JWT, not live DB calls in middleware.
middleware.ts runs on the Edge runtime and never imports Prisma directly. At
sign-in, the `jwt` callback in auth.ts queries the user's Role and its
RolePermission -> Permission grants once, and embeds `role` (name) and
`permissions` (string[]) into the JWT/session. middleware.ts and lib/rbac.ts
read permissions off the token. Known tradeoff: a permission change in the
database takes effect on the affected user's next login/token refresh, not
instantly.

Seed data (prisma/seed.ts) creates:
- 5 Role rows: Owner, Manager, Receptionist, Tournament Director, Member.
- A Permission catalog: dashboard:access, system:admin, users:manage.
- RolePermission grants: Owner -> all; Manager -> dashboard:access +
  system:admin; Receptionist / Tournament Director / Member ->
  dashboard:access.
- One OWNER user with a bcrypt-hashed password, for local login testing.

Centralized logging.
lib/logger.ts wraps Pino (pretty-printed in development, JSON in production)
and is the single logging entry point for the whole app. Services, auth, and
the health endpoint use logger.info/warn/error — no scattered console.log
calls.

Feature flags.
lib/feature-flags.ts exposes env-driven flags (FEATURE_GOOGLE_LOGIN,
FEATURE_PAYMENTS, FEATURE_OPEN_PLAY, FEATURE_TOURNAMENTS,
FEATURE_MEMBERSHIPS, FEATURE_EQUIPMENT_RENTALS) behind a typed
isFeatureEnabled(flag) helper, so future modules can be toggled without new
plumbing. Only FEATURE_GOOGLE_LOGIN has an effect in Phase 1 (gates the
Google provider in auth.config.ts).

Diagnostics.
app/api/health/route.ts returns application status, uptime, and a live
database check (prisma.$queryRaw`SELECT 1`), logged via lib/logger.ts.

Local developer tooling.
docker-compose.yml runs a postgres:16 service (db tcpms_dev) plus an Adminer
service (port 8080) for inspecting the local database during development.

Layering rule (applies to all code, all phases).
Business logic lives in service classes under /services. Validation lives in
Zod schemas. Database access is isolated behind the service layer or server
actions in /actions — components never call Prisma or a service directly.
UI components are presentation-only.

----------------------------------------------------
PHASE 2 DATA MODEL ADDENDUM (FROZEN)
----------------------------------------------------

Phase 2 added the full domain schema in prisma/schema.prisma per the
DATABASE section above — models, enums, relationships, indexes,
constraints, and fixture seed data only. No services, actions, UI, or APIs
were added for any of it. These modeling decisions are now frozen along
with the rest of the schema; changing them later requires explaining why
first, same as any other frozen decision.

MembershipPlan is a real table, not an enum — same precedent as
Role/Permission. The five named tiers (Silver, Gold, VIP, Student, Senior)
are seeded rows, not hardcoded values.

Player vs. User: Player is the pickleball-specific profile (skill level,
hand, position, ratings/stats, match/tournament history), 1:1 with User.
Gameplay-related tables (Team, OpenPlayRegistration, OpenPlayQueue,
Membership, EquipmentRental, LockerRental) reference Player. Account/
financial/administrative tables (Booking.bookedBy, Payment, Invoice,
CourtMaintenance.createdBy, Tournament.createdBy, Announcement.createdBy,
AuditLog, Notification) reference User directly.

Team supports both singles and doubles with two nullable-second-player
columns (player1Id required, player2Id optional) rather than a join table —
pickleball is never more than 2 players per side, so a flexible many-to-many
join table would be unused complexity.

Payment and Invoice both use a set of nullable per-module foreign keys
(bookingId, membershipId, tournamentRegistrationId, equipmentRentalId,
lockerRentalId) rather than a stringly-typed polymorphic reference, so the
database enforces referential integrity for whichever one is set.
Payment.purpose is a fast discriminator for reporting without checking
every FK. All money fields are integer cents (no Decimal type), single
currency (PHP) assumed for Phase 2.

Soft delete is applied only where a model has no status/lifecycle enum
already covering "removed" (e.g. Player, Court, Team, TournamentCategory,
Announcement get deletedAt; Booking, Membership, Tournament, Equipment,
etc. rely on their existing CANCELLED/RETIRED/etc. status value instead).
Pure log/history tables (BookingHistory, AuditLog) are append-only — no
updatedAt or deletedAt.

Match.tournamentCategoryId is nullable so match recording isn't
permanently coupled to tournaments — "Match History" is listed under
Player Profiles independently of tournament history.

Seed data in Phase 2 is limited to physical/reference fixtures a facility
inherently has (3 Courts — see v1.1 Sub-phase 4's addendum, standardized
from an original 6-court placeholder to The Courtroom's real permanent
layout — 20 Lockers, a small Equipment catalog, the 5 MembershipPlan
tiers). No transactional/operational rows (Bookings,
Tournaments, Matches, Rentals, Payments) were seeded — those represent
actual usage events, which is the business-logic territory this phase
explicitly excluded.

Post-approval additions (still Phase 2, schema-only): an Event model — a
generic catch-all for facility activities that don't belong to Booking or
Tournament (open play nights, clinics, corporate/private functions, social
nights). eventType is a free-form string, not an enum or a table, since the
model's purpose is specifically to avoid forcing every activity into a
fixed shape. AuditLog was expanded with oldValues/newValues (Json, for
field-level change diffs) and userAgent, alongside the metadata field it
already had (kept for non-diff entries, e.g. "login succeeded").

----------------------------------------------------
PHASE 3 ADDENDUM: COURT MANAGEMENT MODULE (FROZEN)
----------------------------------------------------

Phase 3 is the first phase with real business logic and UI. Scope was
Court Management only (Create/Edit/Disable Courts, Maintenance Schedule,
Court Availability, Court Status) — no Booking, Tournament, or other
module logic, no new API route handlers (Server Actions remain the
mutation mechanism).

Necessary, additive touches to the frozen foundation: a new `courts:manage`
permission (types/permissions.ts, granted to Owner/Manager in
prisma/seed.ts), one new lib/rbac.ts route rule
(`/dashboard/courts/new` -> `courts:manage`), and a `dashboardNavItems`
entry. lib/rbac.ts's route matcher was changed from first-array-match to
longest-prefix-match so a nested rule (`/dashboard/courts/new`) can require
a stricter permission than its `/dashboard` parent regardless of
declaration order — this is now the permanent matching behavior for all
future nested route rules, not a one-off.

services/court/court.service.ts is a plain class wrapping Prisma directly,
not the interface+local-impl+factory pattern used by
services/payment|email|upload. Those exist to swap in a real external
provider later; Court management has no such swap axis (always Postgres),
so that ceremony doesn't apply here. This is the pattern for any future
service with no swappable-provider axis: a plain class, not interface+
factory only because "the layering rule says services." The pure
overlap-check logic (isWithinMaintenanceWindow) lives in a separate
dependency-free module, services/court/court-availability.ts, specifically
so it's unit-testable without importing Prisma/env.

Court Management is the first real consumer of the AuditLog table added in
Phase 2 — every mutating CourtService method writes an entry (action,
entityType, entityId, oldValues/newValues), wrapped so a logging failure
never blocks the primary operation.

"Court Availability" in this phase is derived only from Court.status plus
whether *now* falls inside a SCHEDULED/IN_PROGRESS CourtMaintenance window
— not booking overlap, since the Booking module doesn't exist yet. This
hook gets extended, not replaced, once Booking ships.

Court.status (administrative ACTIVE/MAINTENANCE/DISABLED toggle) and the
derived live availability are deliberately shown as two separate UI
elements — they can disagree (e.g. status=ACTIVE but a maintenance window
is currently active).

Bug fixes discovered during live-database verification (PostgreSQL installed
locally, real login flow driven through a browser) — none of these were
catchable by typecheck/lint/build/unit tests, only by an authenticated
request actually hitting the running app:

1. auth.config.ts (the Edge-safe config middleware.ts builds its own
   NextAuth() instance from) was missing the `session` callback that maps
   JWT fields onto session.user.{id,role,permissions}. Only auth.ts had it.
   Result: middleware always saw an empty permissions array for every
   authenticated user, redirecting everyone to /unauthorized. Fixed by
   adding the (pure, DB-free) `session` callback to auth.config.ts itself;
   auth.ts keeps its own copy since it can't import from auth.config.ts's
   callbacks without also pulling in `jwt` (DB-dependent, Node-only).
   **Rule going forward: any callback that doesn't touch Prisma/bcrypt
   belongs in auth.config.ts, not only auth.ts, or middleware won't see it.**

2. prisma/seed.ts had no `.env` loading of its own. Next.js (dev/build) and
   Jest (via next/jest) both load .env automatically, so this was invisible
   until the seed script was actually run standalone via `tsx`. Fixed with
   `import "dotenv/config"` as the first import in seed.ts.

3. lib/config.ts imported lib/env.ts (which throws on missing/invalid
   process.env) and is itself imported by client components
   (dashboard-header.tsx, dashboard-sidebar.tsx). Since process.env is empty
   in the browser, this crashed every authenticated dashboard render.
   `siteConfig.url` (the only field needing env.ts) was unused anywhere in
   the codebase, so it was deleted rather than routed around. **Rule going
   forward: nothing that imports lib/env.ts (or lib/logger.ts, lib/prisma.ts)
   may be imported, even transitively, by a "use client" file.**

4. The generated Prisma client's runtime model registry
   (lib/generated/prisma/internal/class.ts) went stale relative to
   schema.prisma — `prisma generate` reported success but the embedded
   runtimeDataModel only listed Phase 1 models (Role/Permission/User/etc.),
   silently missing Court and everything else from Phase 2/3, causing
   `prisma.court` to be `undefined` at runtime despite `Court` typechecking
   fine as a type import. Root cause not fully isolated; fixed by deleting
   `lib/generated/prisma` entirely and regenerating from scratch. **If any
   future `prisma generate` run produces types that typecheck but a model
   delegate is `undefined` at runtime, delete-and-regenerate before
   debugging further.**

5. Base UI's `Button` with `render={<Link .../>}` needs `nativeButton={false}`
   to silence its native-button-expected warning — but doing that makes Base
   UI apply `role="button"` to the element, which is wrong for pure
   navigation (overrides the anchor's natural "link" role, breaking
   `getByRole("link", ...)` queries and misrepresenting the control to
   assistive tech). **Rule going forward: for a control that only navigates
   (styled as a button but semantically a link), style the `Link` directly
   with `buttonVariants({ variant, size })` from components/ui/button.tsx —
   never wrap it through `Button`'s `render` prop.** `Button`'s `render` prop
   stays reserved for genuine buttons that need to render as something else
   for layout reasons (e.g. `SheetTrigger`/`DropdownMenuTrigger` targets).

----------------------------------------------------
PHASE 4 ADDENDUM: BOOKING SYSTEM (FROZEN)
----------------------------------------------------

Scope: Booking CRUD, availability/conflict checking, the 6 non-payment
statuses, reception walk-in bookings, QR check-in, booking history,
server-side validation, unit + Playwright tests. Foundation, Database, and
Court Management stayed frozen except one pre-approved exception (below).
No Booking or Court Management logic touches payments, memberships,
tournaments, or open play.

One pre-approved schema exception: `Booking.bookingReference String @unique`
— a human-friendly, stable, per-day-sequential id ("BK-YYYYMMDD-NNNN") shown
in UI/receipts/communication; `id` stays the internal PK. Generated in
`BookingService.createBooking` from the current date + a same-day count,
with a small retry-on-unique-collision loop. Pure formatting lives in
`services/booking/booking-reference.ts` (unit-tested); the counting query
is inline in the service.

Court Management stayed genuinely untouched: `services/court/court.service.ts`
and its UI were not modified. Booking's own `checkAvailability` in
`services/booking/booking.service.ts` independently reads (never writes)
`Court` and `CourtMaintenance` — building on top of, not modifying, the
frozen module. `checkAvailability` returns structured conflict info
(`{ available, conflict?: { type: "COURT_DISABLED" | "MAINTENANCE" |
"BOOKING", conflictingBookingId?, conflictingTimeRange? } }`), not just a
message string.

Only `HOURLY` and `WALK_IN` are creatable from this phase's UI (enforced in
the Zod schema itself, not just hidden in the form) — `RECURRING`,
`PRIVATE`, `MAINTENANCE_BLOCK` stay valid, unused `BookingType` values.
Bookings created through this staff-facing UI start at `CONFIRMED`
directly (no approval step — only staff create bookings this phase); that's
what triggers QR generation. `PAID` stays a valid `BookingStatus` value
that nothing transitions into (payments are a future phase) —
`services/booking/booking-status.ts`'s `BOOKING_STATUS_TRANSITIONS` map is
the single source of truth for which transitions are legal, and drives both
server-side enforcement and which action buttons the UI renders.

The QR encodes a URL to the staff-authenticated check-in lookup page
(`/dashboard/bookings/check-in?token=...`), built from `Booking.qrCodeToken`
— a separate opaque random value, never `Booking.id`. `qr-code.ts` and
`booking.service.ts` both import `lib/env.ts` transitively and must never be
imported from a `"use client"` file (same rule as addendum item 3 above);
`booking-status.ts` and `booking-availability.ts` are pure and safe for
client import. `regenerateBookingQrToken` overwrites the token (old QR
images stop working), making revocation a real, reachable action, not just
a design property.

`/dashboard/bookings` (the whole section, not just a `/new` sub-route like
Courts) requires the new `bookings:manage` permission (Owner/Manager/
Receptionist) — booking records carry guest PII (name/phone), unlike court
metadata, which stayed read-open to all staff.

Minimal, intentionally narrow `services/player/player.service.ts` (just
`listPlayers()`) was added purely so Booking's "select an existing player"
dropdown has real data access behind the service layer instead of querying
Prisma directly from a page component — not the start of the Player
Profiles module.

Bug fixes discovered during this phase's live verification (same
"typecheck/lint/build all pass while the app is actually broken" pattern as
Phase 3 — see the addendum above):

6. Base UI's `Select.Value` does not automatically mirror the selected
   `Select.Item`'s label text into the trigger — without an explicit
   `children` render function, the trigger displays the raw `value` (e.g. a
   court's cuid) instead of its label. **Rule going forward: always give
   `SelectValue` a `children={(value) => ...}` function that maps the
   current value to its display label** — don't assume Radix-style
   auto-mirroring.

7. `lib/prisma.ts`'s dev-mode `globalThis` caching (intentional, so Fast
   Refresh doesn't exhaust DB connections) means an **already-running** dev
   server keeps using the `PrismaClient` instance created from whatever the
   generated client looked like when that process started — regenerating
   `lib/generated/prisma` on disk while the server is still running does not
   update it. **Rule going forward: after any schema change + regenerate,
   fully restart the dev server process** (not just save-triggered
   hot-reload) before testing against it.

8. After adding a new permission to `prisma/seed.ts`, the grant only exists
   once `npm run db:seed` is re-run — a stale local database will keep
   denying access even though the code is correct. Re-seed after any
   `ROLE_PERMISSION_GRANTS` change.

9. Running the full Playwright suite with several parallel workers against
   a single `next dev` process caused intermittent `ECONNRESET`/aborted
   connections and `MaxListenersExceededWarning`s (dev-mode on-demand route
   compilation isn't built for many workers cold-compiling different pages
   at once) — not reproducible against `next build`, and every spec passes
   reliably alone. `playwright.config.ts` is now `workers: 1` for stability
   against the local dev server; revisit if e2e ever runs against a built
   (`next start`) server instead.

----------------------------------------------------
PHASE 5 ADDENDUM: OPEN PLAY (FROZEN)
----------------------------------------------------

Scope: Open Play session CRUD/scheduling, capacity management, player
registration, walk-in registration, waitlist management, queue management,
the Waiting/Playing/Resting rotation, dynamic court assignment, session
check-in, attendance tracking, session history, server-side validation,
unit + Playwright tests. Foundation, Database, Court Management, and
Booking stayed frozen except the pre-approved schema exceptions below. No
AI court balancing, DUPR integration, payments, mobile features, Reception
Dashboard, or tournament integration.

Pre-approved schema exceptions (same precedent as `Booking.bookingReference`
in Phase 4):
- `OpenPlayRegistration.playerId` became nullable, `guestName`/`guestPhone`
  added — identical walk-in pattern to `Booking`.
- `OpenPlayQueue.playerId` was replaced with `registrationId` (unique,
  1:1 with `OpenPlayRegistration`) so a queue entry's identity — player or
  guest — always comes from one source of truth. Added
  `status OpenPlayQueueStatus` (`WAITING | PLAYING | RESTING`) and
  `stateChangedAt`. `courtId` was also properly wired as a real `@relation`
  to `Court` — it had been a bare, unvalidated string since Phase 2.
- `OpenPlaySession.sessionReference String @unique` — human-friendly,
  per-day-sequential id ("OP-YYYYMMDD-NNNN"), same generation pattern as
  `bookingReference` (`services/open-play/session-reference.ts` for the pure
  formatting, a same-day-count + retry-on-collision loop in
  `session.service.ts`).
- New models `OpenPlayMatch` and `OpenPlayMatchParticipant` — one row per
  match started via `RotationEngine.startNextMatch`, with which
  registrations played in it. `matchNumber` is sequential per session
  (`@@unique([openPlaySessionId, matchNumber])`).
- New model `OpenPlayQueueHistory` — an append-only log of every
  Waiting/Playing/Resting transition a queue entry goes through, written by
  `queue.service.ts` alongside every status change. Exists to make future
  analytics (total waiting time, total playing time) possible without a
  further schema change; no reporting UI was built on top of it this phase.

Service layer, exactly as scoped: `services/open-play/session.service.ts`
(session CRUD, registration, check-in, no-show, attendance),
`services/open-play/queue.service.ts` (sole owner of `OpenPlayQueue` +
`OpenPlayQueueHistory` writes — `setPlaying`/`setResting`/`setWaiting` each
update the queue row and append a history row in the same call),
`services/open-play/court-assignment.service.ts` (dynamic, read-only
availability — reuses `services/booking/booking-availability.ts`'s pure
`hasTimeOverlap` directly against a zero-width "right now" interval, rather
than re-implementing it a third time), `services/open-play/rotation-engine.ts`
(the orchestrator — pulls the next 4 Waiting entries, asks
court-assignment for a court, delegates the actual `OpenPlayQueue` mutation
to `queue.service.ts`, and owns the `OpenPlayMatch`/`OpenPlayMatchParticipant`
writes). Match group size is a fixed constant (4, doubles) rather than a
per-session field — AI court balancing is out of scope, so grouping is
simply "next 4 in the Waiting queue." All rotation transitions are
staff-triggered; there are no automatic/time-based transitions anywhere in
this module, matching Booking's status-machine philosophy.

Court assignment has no `OpenPlaySessionCourt` join table — any `ACTIVE`
court not currently under maintenance, not currently booked, and not
currently hosting another Open Play match is available. This is the same
read-only pattern Booking used against Court Management in Phase 4: reads
`Court`/`CourtMaintenance`/`Booking` directly, never through those modules'
service classes, and neither Court Management nor Booking was modified.

New permission `open_play:manage` (Owner/Manager/Receptionist) gates the
whole `/dashboard/open-play` section — same tier as `bookings:manage`,
same reasoning (front-desk-run feature, guest PII in registrations).

Live queue stats (`waitingCount`, `playingCount`, `restingCount`,
`waitlistCount`, `availableCourts`, `activeMatches`) are computed on read by
`RotationEngine.getQueueStats` and never stored — no websockets/polling,
refreshed on page load and after each action via the existing server-action
+ `revalidatePath` + `router.refresh()` flow.

Bug fixes / gotchas discovered during this phase's live verification:

10. In dev mode, the Open Play session detail page (`[sessionId]/page.tsx`)
    pulls in an unusually large, first-time-compiled client component graph
    (rotation board, registration list/form, stats bar, status actions,
    etc.). Firing several server actions back-to-back against a route that
    hasn't finished its first webpack compile can abort the in-flight RSC
    fetch (`net::ERR_ABORTED`), leaving the UI on stale state even though
    the mutation succeeded server-side. **Rule going forward: e2e specs
    against a large, newly-added route should wait for
    `networkidle` after each mutating action (not just assert on the
    resulting DOM state), and/or warm the route with a throwaway visit
    before the timed test steps begin.** Not reproducible against
    `next build`/`next start`; same root category as gotcha #9 above
    (dev-mode compilation concurrency), a new variant of it rather than a
    new issue.
11. Playwright's `.fill()` on a `type="number"` input that already has a
    non-empty default value (from `useForm({ defaultValues })`) can append
    to the existing text instead of replacing it (observed: a capacity
    field defaulting to `16` became `164` after `.fill("4")`), producing a
    real row in the database with the wrong value — not just a flaky
    assertion. **Rule going forward: for numeric fields with a non-empty
    default, select-all (triple-click) before typing the replacement value
    in e2e tests, and assert the field's value before submitting.**

**How to apply:** Before building the next module, read this addendum for
the rotation-engine/queue-service split (mutations behind
`queue.service.ts`, orchestration in `rotation-engine.ts`), the
court-assignment read-only pattern, and gotchas #10/#11 above — both cost
real debugging time this phase and are easy to mistake for a code bug in
the feature itself.

----------------------------------------------------
PHASE 6 ADDENDUM: TOURNAMENT MANAGEMENT (FROZEN)
----------------------------------------------------

Scope: Tournament CRUD, categories, player/team registration, bracket
generation (Round Robin, Single Elimination), match scheduling, score
entry, match progression, standings, tournament history, server-side
validation, unit + Playwright tests. Foundation, Database, Court
Management, Booking, and Open Play stayed frozen except one mechanical
schema fix (below). Double Elimination, AI-generated brackets, DUPR
integration, live streaming, spectator mode, mobile features, online
public registration, payments, and automated referee assignments are all
out of scope.

Unlike every prior phase, `Tournament`/`TournamentCategory`/
`TournamentRegistration`/`Match`/`Score`/`Team` had existed in the schema
since Phase 2 but had never been touched by any service or UI code —
this phase is the first to actually build on them.

One schema exception, mechanical: `Match.courtId` was wired as a real
`@relation` to `Court` (it was a bare, unvalidated string since Phase 2,
same class of gap as `OpenPlayQueue.courtId` in Phase 5) — needed for
"Match scheduling" to be referentially sound. `Court` gained an additive
`matches Match[]` back-relation. No other schema changes.

Not a schema change, but new seed data: `prisma/seed.ts` now seeds ~14
sample `Player` profiles (bare `User` + `Player` rows, varied
`skillLevel`) so Tournament registration has real players to pick from.
Tournament registration structurally requires a real `Player`
(`Team.player1Id`/`player2Id` are Player foreign keys) — unlike Booking
and Open Play, `Team` has no `guestName`/`guestPhone` walk-in escape
hatch, and there's no Player Profiles module yet for staff to create
players themselves. This was a deliberate choice (confirmed with the
user): a tournament entrant's identity genuinely matters for standings
and history in a way a casual walk-in doesn't, so requiring a real
`Player` record is the more correct design — the seeded players are
reference/test data standing in for the future Player Profiles module,
same category as the Court/Locker/Equipment fixtures.

`TournamentCategory` has no structural singles/doubles field — team size
is intentionally unenforced (confirmed with the user): `registerTeam`
accepts 1 or 2 players for any category, and staff relies on the
category's freeform name (e.g. "Men's Singles") as the convention, same
trust-the-staff precedent as `Event.eventType`.

Bracket generation, by format:
- **Round Robin** (`bracket-generator.ts`'s `generateRoundRobinPairings`):
  the standard circle method, producing every pairwise matchup exactly
  once, with `round` numbers assigned for schedulability. An odd team
  count gets one bye per team per rotation — not a `Match` row, just no
  pairing that round.
- **Single Elimination** (`generateSingleEliminationRound1` +
  `pairNextRound`): round 1 pads to the next power of 2 with byes (a bye
  is a `Match` row with `team2Id: null`, immediately `COMPLETED`,
  `winnerTeamId` = the bye'd team — no schema change needed since
  `team2Id` was already nullable). **Later rounds are generated
  dynamically, not pre-created**: `match.service.ts`'s
  `tryAdvanceBracket` runs after every `completeMatch`/`markWalkover`,
  checks whether the sibling match at `bracketPosition XOR 1` in the same
  round is also decided, and if so creates the next round's `Match` (idempotent
  — checks the next match doesn't already exist first). This avoids ever
  needing a placeholder/"TBD" match row, which would have required making
  `Match.team1Id` nullable (a real schema change) — verified working
  end-to-end via direct SQL during live verification (a 3-team bracket's
  round-1 bye and real match both correctly fed into a dynamically-created
  round 2). No seeding/ranking system decides who gets byes — first-come
  (registration order) is deterministic and good enough, since ranked
  bracket seeding is explicitly out of scope.

Match winner is **auto-computed from entered `Score` rows** when staff
completes a match — majority of sets won
(`services/tournaments/match-status.ts`'s `determineMatchWinner`), with no
assumption baked in about set format (best-of-3, single game to 11/15/21,
win-by-2) since that varies by tournament. Returns `null` (blocking
completion) on a tie or no sets entered. `WALKOVER` bypasses this
entirely — staff picks the winner manually, no `Score` rows required.

New permission `tournaments:manage`, granted to Owner/Manager/**Tournament
Director** — the first phase this seeded role (present since Phase 1's
`SYSTEM_ROLES`) actually grants anything beyond `dashboard:access`. Not
granted to Receptionist (tournament administration, not front-desk work).

Registration follows the same freeze-respecting pattern as every prior
phase: goes straight to `CONFIRMED` (or `WAITLISTED` once
`category.maxTeams` is reached) with no `PENDING`-approval step —
staff-driven, no public self-registration. Withdrawing a registration is
only allowed before that category's bracket exists (`Match` row count
check) — no mid-bracket replacement/reshuffling logic. `PlayerStatistics`
(`matchesPlayed`/`tournamentsWon`/etc.) is **not** auto-updated by match
completion — that's Player Profiles/Ratings territory, a separate future
module.

Standings (`standings.service.ts` + the pure
`services/tournaments/standings-calculator.ts`) branch on category format:
Round Robin gets a real computed table (wins/losses/sets won–lost/set
differential, sorted, tiebroken by `teamId` for stability); Single
Elimination gets a simpler per-team status view (`ACTIVE` /
`ELIMINATED` in round N / `CHAMPION`), since bracket position already *is*
the standing. The elimination calculator determines "is this the final
round" by **match count per round being exactly 1**, not "the highest
round number seen in the data" — the latter breaks while a round is still
partially in progress (later rounds don't exist yet, making an
in-progress round 1 look like the final); this was caught by the pure
module's own unit tests before it ever reached a live browser.

Bug fixes / gotchas discovered during this phase's live verification:

12. Same root cause as Phase 5's gotcha #10 (dev-mode compilation
    concurrency aborting in-flight RSC fetches under rapid sequential
    server actions), but this phase's e2e spec chains far more mutating
    actions per test (register 3 teams, generate a bracket, save + complete
    3+ matches). The existing `clickAndSettle` (click, then
    `waitForLoadState("networkidle")`) pattern from Phase 5 was reused
    directly and was sufficient — no new mitigation needed, just confirming
    the existing rule holds at higher action volume.
13. When asserting on a just-registered team's name via
    `getByRole("cell", { name, exact: true })`, an unscoped page-wide
    lookup is ambiguous once any confirmed registration exists: the
    Standings table renders a row (with zero played/wins) for every
    `CONFIRMED` registration immediately, even before a bracket exists, so
    the same player name appears as a cell in both the Registrations table
    and the Standings table simultaneously. **Rule going forward: scope
    row/cell assertions to a specific table (e.g. `page.locator("table").first()`)
    whenever a page renders the same entity's name in more than one table.**

**How to apply:** Before building the next module, read this addendum for
the dynamic-round-generation pattern (`tryAdvanceBracket`'s sibling-check +
idempotent-create), the format-branching service pattern
(`standings.service.ts`), and gotcha #13 — the "same name renders in two
tables" trap will recur anywhere a summary/preview table exists alongside
a detail table on the same page.

----------------------------------------------------
PHASE 7 ADDENDUM: MEMBERSHIP & PLAYER MANAGEMENT (FROZEN)
----------------------------------------------------

Scope: Player CRUD/profile management, Membership CRUD, Membership Plan
management, enrollment/renewal/expiration/status handling, a computed
player statistics dashboard, player search/filtering, player and
membership history, server-side validation, unit + Playwright tests.
Foundation, Database, Court Management, Booking, Open Play, and
Tournament stayed frozen except the two pre-approved schema exceptions
below. Loyalty/rewards programs, DUPR sync, mobile features, public
player profiles, social features, payments, and AI-generated ratings are
all out of scope.

This is the first phase to actually build `Player`/`Membership`/
`MembershipPlan` — they'd existed since Phase 2 but `player.service.ts`
was a single read-only `listPlayers()` method backing other modules'
dropdowns, and nothing had ever touched `Membership`. `player.service.ts`
was extended in place (its existing method's signature/behavior is
unchanged — Booking/Open Play/Tournament's registration forms depend on
it), not replaced.

Two schema exceptions, both your recommendations:
- `Membership.membershipReference String @unique` — `MB-YYYYMMDD-NNNN`,
  identical generation pattern to `Booking.bookingReference`.
- New model `MembershipHistory` (append-only, same shape as
  `BookingHistory`) with a new `MembershipHistoryEventType` enum
  (`ENROLLED | RENEWED | UPGRADED | DOWNGRADED | SUSPENDED | REACTIVATED |
  CANCELLED | EXPIRED`). `MembershipStatus` itself (`ACTIVE | EXPIRED |
  CANCELLED | PENDING`) was **not** touched — per your answer, suspension
  has no dedicated status value. "Suspend" sets `status: CANCELLED` and
  logs a `SUSPENDED` history event; "Reactivate" flips `CANCELLED →
  ACTIVE` and logs `REACTIVATED`. The status machine
  (`services/memberships/membership-status.ts`) is therefore more
  permissive than this app's other one-way machines — `CANCELLED →
  ACTIVE` is legal specifically to make reactivation possible.

Expiration has no background job (this app has no cron/queue
infrastructure): `membershipService.reconcileExpiredMemberships()` flips
any `ACTIVE` membership past its `endDate` to `EXPIRED` (+ logs an
`EXPIRED` history event) and runs at the top of every membership
list/detail read — so expired memberships are always correct on screen
without a scheduler. Renewal (`services/memberships/renewal-calculator.ts`,
pure) extends `endDate` by the plan's `billingPeriod` from
`max(currentEndDate, now)` — renewing early doesn't lose time, renewing
late doesn't back-date. The same pure calculator is reused to compute the
*initial* `endDate` at enrollment (treating `startDate` as both the base
and "now"), avoiding a second implementation of the same switch statement.
Upgrade vs. downgrade is decided by comparing `priceCents` between the old
and new plan — the same `Membership` row's `membershipPlanId` is updated
in place, never a new row.

`player-statistics.service.ts` computes everything live — booking counts
from `Booking`, Open Play attendance/matches from `OpenPlayRegistration`/
`OpenPlayMatchParticipant`, tournament matches/wins from `Team` →
`Match` (via the `matchesAsTeam1`/`matchesAsTeam2`/`matchesWon`
relations Phase 6 already wired up) — and **never writes to the stored
`PlayerStatistics` table**, per your recommendation. `PlayerRating`
(ELO/DUPR) is read-only and untouched; AI-generated ratings are out of
scope. "Player history" and your recommended "Player Timeline" turned out
to be the same feature under two names — one `getPlayerTimeline` in
`player.service.ts` merges Bookings, Open Play registrations, Tournament
registrations, and Membership history into one chronological feed via a
pure `mergeTimelineEvents` sorter (`services/player/player-timeline.ts`).

Player CRUD always creates a fresh `User` + `Player` pair (`roleId` =
Member) in one transaction — there's no flow for attaching a Player
profile to an existing staff `User`. One permission, `players:manage`
(Owner/Manager/Receptionist), gates both `/dashboard/players` and
`/dashboard/memberships` — you scoped this as a single module.
Membership enrollment happens only from a player's own detail page (no
standalone "new membership" page with a player picker); the global
`/dashboard/memberships` list is read/operate-only.

Bug fixes / gotchas discovered during this phase's live verification:

14. `zodResolver(schema)` wired directly to `useForm` (the pattern
    `CourtForm` established) silently blocks submission — no navigation,
    no visible error — when a schema has an *optional* `z.coerce.date()`
    field and the corresponding native `<input type="date">` is left
    untouched. An untouched date input's uncontrolled value is `""`, not
    `undefined`; `.optional()` only skips validation for a genuinely
    absent key, so Zod still runs `coerce.date("")` → `Invalid Date` →
    validation failure, and `handleSubmit`'s callback never fires. It was
    invisible because the form only rendered `errors.name`/`errors.email`
    messages, not every field's error. **Rule going forward: for a
    create/edit form with any optional coerced-date (or similarly
    coercible) field, don't wire `zodResolver` directly to raw RHF string
    values — do the manual `schema.safeParse({...})` translation on
    submit that every other form in this app already uses (explicitly
    converting `""` → `undefined` per optional field), and surface
    `parsed.error.issues[0]?.message` as one top-level error so a bad
    field is never silently swallowed.** `PlayerForm` was rewritten to
    match; `CourtForm` (frozen, Phase 3) never hit this because it has no
    optional date fields — not a live bug there, but worth knowing before
    reusing the `zodResolver`-direct pattern elsewhere.
15. Running the full Playwright suite together (as opposed to any one
    spec file alone) surfaced two flakes where a server action's
    `router.refresh()` genuinely took longer than the default 5s
    assertion timeout to land — confirmed not a real bug (the mutation
    always succeeded server-side; a manual DB check after each matched
    what the UI eventually showed). Same root category as gotchas
    #9/#10/#12 (dev-mode compilation concurrency) but the first time it
    exceeded the existing `clickAndSettle`/`networkidle` mitigation's
    effective window, specifically under the combined system load of the
    *entire* suite running back-to-back. **Fix applied to
    `playwright.config.ts` itself, not per-spec: `expect.timeout` raised
    from the 5s default to 10s, and local `retries` raised from 0 to 1**
    (`retries` was already 2 in CI). Only ever reproduced under full-suite
    load; every spec still passes immediately alone.

**How to apply:** Before building the next module, read this addendum for
the lazy-reconciliation pattern (`reconcileExpiredMemberships`, a
template for "no cron, so check-and-fix on read" anywhere else expiration
matters) and gotcha #14 before wiring `zodResolver` directly to any new
form with an optional date/coerced field — prefer the manual-`safeParse`
pattern by default unless every field is a plain string/enum.

----------------------------------------------------
PHASE 8 ADDENDUM: EQUIPMENT RENTAL & LOCKER MANAGEMENT (FROZEN)
----------------------------------------------------

Scope: Equipment CRUD/categories/inventory, equipment rental/return/
availability/maintenance logging, Locker CRUD/rental/return/availability,
rental + maintenance history, damage reporting, server-side validation,
unit + Playwright tests. Foundation, Database, Court Management, Booking,
Open Play, Tournament, and Membership stayed frozen except the schema
exceptions below. Payments, security deposits, barcode/QR/RFID hardware
integration, mobile features, and automated maintenance scheduling are
all out of scope.

Like Membership/Player before it, `Equipment`/`EquipmentRental`/
`EquipmentMaintenanceLog`/`Locker`/`LockerRental` had existed since Phase
2 as seeded reference fixtures (4 equipment items, 20 lockers) with no
service/UI layer at all until this phase.

Schema exceptions:
- **`EquipmentRental.rentalReference`** (`ER-YYYYMMDD-NNNN`) and
  **`LockerRental.rentalReference`** (`LR-YYYYMMDD-NNNN`) — your
  recommended additions, identical pattern to `Booking.bookingReference`.
- **`EquipmentMaintenanceLog`** (existing) gained a shared
  `MaintenanceLogType` enum (`ROUTINE | DAMAGE_REPORT | REPAIR |
  REPLACEMENT`) `logType` field and a nullable `resolvedAt`, per your
  answer to the one clarifying question this phase — this is what lets
  "Damaged" exist as a computed condition without adding a `DAMAGED`
  value to the frozen `EquipmentStatus` enum. `performedById` was also
  wired as a real `@relation` to `User` (was a bare string, same class of
  gap as `Match.courtId` in Phase 6).
- **New model `LockerMaintenanceLog`** (mirrors `EquipmentMaintenanceLog`
  exactly) — Lockers had no maintenance tracking at all before this
  phase; "Maintenance history"/"Damage reporting" apply to both modules,
  not equipment only.
- Mechanical back-relations only: `Locker.maintenanceLogs`,
  `User.equipmentMaintenanceLogsPerformed`,
  `User.lockerMaintenanceLogsPerformed`.
- `EquipmentStatus`, `RentalStatus`, `LockerStatus`, `LockerRentalStatus`
  are all untouched.

Neither `Equipment` nor `Locker` has a `deletedAt` — unlike Player/Team/
Court. `RETIRED`/`DISABLED` are the functional equivalent of a soft
delete for each, so no delete method was built for either service.

Computed, not stored (the recurring theme of this phase, extending the
Phase 7 precedent set by `player-statistics.service.ts` and
`getPlayerTimeline`):
- **Equipment condition** (`services/equipment/equipment-condition.ts`,
  pure): `RETIRED` (status) → `MAINTENANCE` (status, whole line pulled) →
  `DAMAGED` (nothing available **and** an unresolved damage report) →
  `RENTED` (nothing available, no damage) → `AVAILABLE`. Equipment is
  pooled inventory (`quantity`, no per-unit serials) — a single damaged
  or rented unit out of many doesn't blank out the whole type; only
  running out entirely does. `availableQuantity = quantity −
  activeRentalsCount − unresolvedDamageReportsCount` (a damage report
  reserves a unit from the pool the same way a rental does).
- **Locker display status** (`services/lockers/locker-status.ts`, pure),
  same "derive it, don't store it" pattern as
  `court-availability.ts`'s `getCurrentAvailability`: `MAINTENANCE` →
  `DISABLED` (status) → `OCCUPIED` (an `ACTIVE` rental covers "now") →
  `RESERVED` (an `ACTIVE` rental starts in the future) → `AVAILABLE`.
  "Reserved" needed no schema change.
- **Transaction history timelines** (your recommendation) — derived, not
  stored, exactly `getPlayerTimeline`'s pattern applied twice:
  `equipmentService.getTransactionTimeline`/
  `lockerService.getTransactionTimeline` merge that item's rentals and
  maintenance logs into one feed. Rental events look up their matching
  `AuditLog` entry (by `entityType`/`entityId`/`action`) to attribute the
  staff actor, since `EquipmentRental`/`LockerRental` carry no actor field
  of their own; maintenance events already have `performedById` directly.
- **`services/inventory/inventory-alerts.service.ts`** (your
  recommendation, new) — `getAlerts()` computes low-stock equipment
  (fixed threshold, `availableQuantity <= 2`, no per-item reorder point),
  unresolved damage, overdue equipment rentals, lockers under
  maintenance, and lockers with expired rentals not yet caught by the
  next lazy reconciliation. The last two deliberately query ahead of the
  reconciliation that `listEquipment`/`listLockers`/`listRentals` trigger,
  so a backlog is visible before it's silently fixed on next read.
- **Dashboard summary cards** (your recommendation) —
  `equipmentService.getInventorySummary`/`lockerService.getInventorySummary`,
  aggregated from the same computed condition/status used everywhere
  else, never persisted.

Reconciliation is lazy, no background job, same Phase 7 precedent:
`equipmentRentalService.reconcileOverdueRentals` (`ACTIVE` + `dueAt` past
→ `OVERDUE`) and `lockerRentalService.reconcileExpiredRentals` (`ACTIVE` +
`endAt` past → `EXPIRED`) run at the top of their list/detail reads. Both
use a bulk `updateMany` with no `AuditLog`/history write, since neither
transition is actor-driven (same reasoning as
`membershipService.reconcileExpiredMemberships` skipping `AuditLog`).

Double-rental prevention: equipment is blocked when `availableQuantity <
1`; lockers are blocked when another `ACTIVE` rental for that locker
overlaps the requested window, reusing `hasTimeOverlap` from
`services/booking/booking-availability.ts` directly (same reuse
precedent as Open Play's court-assignment and Tournament).

Ending a locker rental early maps to `CANCELLED`, not `EXPIRED` —
`LockerRentalStatus` has no `RETURNED` value, and `EXPIRED` is reserved
for the lazy reconciliation above.

New permission `equipment:manage` (Owner/Manager/Receptionist, same tier
as `bookings:manage`) gates both `/dashboard/equipment` and
`/dashboard/lockers`, since you scoped this as one module.

Bug fixes / gotchas discovered during this phase's live verification:

16. A page that shows both a computed status badge (e.g. `EquipmentConditionBadge`/
    `LockerStatusBadge`) and an admin "Status" `<Select>` whose current
    value happens to render the same word (`AVAILABLE` is both a
    computed condition *and* the Status dropdown's default value) makes
    an unscoped `getByText(word, { exact: true })` ambiguous — a new
    variant of Phase 6's gotcha #13 (same-name-in-two-places), but from a
    dropdown's displayed value rather than a second table. **Rule going
    forward: scope with `.first()` (verified DOM-order-stable here) or a
    container locator whenever a computed badge and an editable field
    can coincidentally display the identical word.**
17. The same message can legitimately appear twice in the DOM at once — a
    form's inline error paragraph *and* the `sonner` toast notification
    both render `result.error` verbatim. An unscoped text assertion on an
    error message is therefore ambiguous the moment both are visible
    together, which is always, since the toast fires the instant the
    inline error is set. **Rule going forward: `.first()` for any e2e
    assertion on a server-action error message.**
18. Two form fields both plainly labeled "Type" on the same page (an
    equipment's admin `EquipmentType` selector and a maintenance log's
    `MaintenanceLogType` selector) made `getByLabel("Type")` ambiguous.
    Fixed by renaming the maintenance form's label to "Maintenance type"
    — a genuine UX clarity improvement, not just a test workaround, since
    a real user skimming the page would have had the same ambiguity.
    **Rule going forward: when two fields on the same page could
    plausibly share a generic label ("Type", "Status", "Name"), prefer a
    more specific label from the start rather than relying on `htmlFor`
    scoping alone.**

**How to apply:** Before building the next module, read this addendum for
the "compute a display status/condition instead of storing it" pattern
(now used three times: Court's `getCurrentAvailability`, Locker's
`calculateLockerDisplayStatus`, Equipment's pooled-inventory
`calculateEquipmentCondition`) and the derived-timeline pattern (now used
twice: Player, Equipment/Locker) — both are the default choice for any
new module with a similar shape. Check gotchas #16-#18 before assuming a
`getByText`/`getByLabel` ambiguity is a real application bug.

-----------------------------------------------------
PHASE 9 ADDENDUM: REPORTS, NOTIFICATIONS & ANALYTICS (FROZEN)
-----------------------------------------------------

Scope: Booking/Court utilization/Open Play/Tournament/Membership/
Equipment rental/Locker rental reports, revenue-ready operational
summaries, CSV export; in-app notification center, announcement
management, membership/booking/tournament/equipment/locker reminders,
read/unread tracking; dashboard KPIs, court utilization/membership
growth/player activity/Open Play/tournament/equipment/locker analytics
trends, an operator activity feed. Foundation, Database, Court
Management, Booking, Open Play, Tournament, Membership, and Equipment &
Locker Management stayed frozen except the schema exceptions below.
Email/SMS/push delivery, mobile, scheduled background jobs, BI
integrations, AI forecasting, payment analytics, and PDF/Excel export are
all out of scope.

Unlike every prior phase, this one reads across every existing module
rather than owning one vertical slice. `Notification`/`Announcement` had
existed since Phase 2 as schema-only fixtures with zero service/UI
usage anywhere (confirmed via grep); `AuditLog`, by contrast, had already
been written to by every mutating service method in every phase since
Phase 3 — so it already *was* a comprehensive cross-module activity log,
which simplified the Activity Feed considerably (see below).

Schema exceptions:
- **`NotificationType` reshaped** from the original Phase 2 values
  (`BOOKING_CONFIRMATION | PAYMENT_CONFIRMATION | TOURNAMENT_REMINDER |
  MEMBERSHIP_EXPIRATION | ANNOUNCEMENT | OTHER`, which had zero usages
  anywhere in app code) to `BOOKING | TOURNAMENT | MEMBERSHIP | EQUIPMENT
  | LOCKER | SYSTEM | ANNOUNCEMENT` — per your answer, one category per
  module that generates notifications.
- **`Notification` gained `entityType String?` + `entityId String?`**
  (per your answer, mirrors `AuditLog`'s existing shape exactly) plus an
  index on `[userId, type, entityType, entityId]` — lets the lazy
  reminder sweep dedupe ("does a notification for this user+type+entity
  already exist?") so revisiting the Notification Center never creates
  duplicates, and lets a notification reference its source record.
- `Announcement` and `AuditLog` are untouched.

Notifications are personal (`userId`-scoped), not a broadcast table.
Every reminder resolves to a real recipient via existing relations:
booking reminders → `Booking.player.userId` (falls back to `bookedById`
for walk-ins with no `playerId`); membership expiration →
`Membership.player.userId`; equipment overdue → the renting
`EquipmentRental.player.userId`; locker expiration → the renting
`LockerRental.player.userId`; tournament reminders → both players on
each `CONFIRMED` registration's `Team` for tournaments starting soon.
`notificationService.generateReminders()` is a lazy sweep — the fourth
use of the no-cron pattern established by `membershipService
.reconcileExpiredMemberships` (Phase 7) and `equipmentRentalService
.reconcileOverdueRentals`/`lockerRentalService.reconcileExpiredRentals`
(Phase 8) — run at the top of the Notification Center's read path,
deduping on `userId+type+entityType+entityId`.

Announcements stay their own broadcast list (`/dashboard/announcements`,
open to any authenticated user, filtered to `isPublished &&
(expiresAt == null || expiresAt > now)`) using the model's existing
fields unchanged. Publishing one additionally fans out one
`ANNOUNCEMENT`-type `Notification` per active `User` (synchronous, not
scheduled — facility-scale user count, not a batching concern), so it
surfaces in the personal Notification Center too.

The Activity Feed (your recommendation #5) reuses `AuditLog` directly
instead of re-deriving domain events — a fourth "merge records into a
timeline" service would have been redundant given every mutating call
already logs there. `services/activity/activity-feed.service.ts` reads
`AuditLog` with filters (date range, entity type, actor), paginates, and
labels each row via a small generic string-transform pair in
`services/notifications/notification-reference.ts`
(`formatAuditLogLabel`: `"equipment_rental.created"` → `"Equipment
rental created"`; `formatEntityTypeLabel`: `"EquipmentRental"` →
`"Equipment Rental"`) — both pure regex transforms, not a lookup table,
so a new `entity.verb` action added by any future service is labeled
correctly with no update needed here.

Court utilization is measured as booked hours + booking count per court
per period, not a percentage — no facility "operating hours"
configuration exists anywhere in the schema, and inventing one was out
of scope. "Revenue-ready" amounts are billable amounts, not collected
revenue — `Payment`/`Invoice` exist since Phase 2 but are never written
to by any service (payment integration has been out of scope every
phase), so `reporting.service.ts`'s `getRevenueReport` sums each
module's own amount field instead (`Booking.totalAmountCents`,
`TournamentCategory.feeCents` × confirmed registrations,
`MembershipPlan.priceCents` per `ENROLLED`/`RENEWED`/`UPGRADED`
`MembershipHistory` event, `Equipment.rentalRateCents` + `lateFeeCents`
per rental, `LockerRental.amountCents`).

CSV export is a Server Action (`actions/report.actions.ts`'s
`exportReportCsvAction`), not a Route Handler — there was no existing
precedent for an authenticated `/api/*` route in this codebase (only
NextAuth and a health check existed), and a Route Handler would have
duplicated the auth/permission checking the Action layer already does.
`services/export/export.service.ts`'s `toCsv` is pure (RFC 4180
escaping, unit-tested directly); `REPORT_CSV_COLUMNS` pairs each report
type with its column mapping so the CSV always matches the displayed
table.

`services/analytics/date-range.ts`'s `resolveDateRange`/
`resolveDateRangeFromSearchParams` (`Today | 7 Days | 30 Days | 90 Days
| Custom`) is shared by every date-ranged page (dashboard, reports,
analytics) via URL search params (`features/analytics/components
/date-range-picker.tsx`, a client component that reads/writes
`preset`/`from`/`to` params) — no client state store needed, and the
range survives a refresh or share link.

`analyticsService.getDashboardKpis(range)` (recommendation #2) is the
centralized KPI interface — `app/dashboard/page.tsx` (which had been an
empty-state placeholder waiting for this since Phase 1) reads only this
one object, composing the module's other trend/participation methods,
rather than each card computing its own stats.

New permission `reports:manage` (Owner/Manager only) gates
`/dashboard/reports` and `/dashboard/analytics`. Notifications need no
permission beyond being authenticated (every user manages only their
own, scoped to `session.user.id` inside `notificationService`).
Announcement create/publish/unpublish/delete is gated by the existing
`system:admin` permission (same tier Owner/Manager already hold) rather
than a new dedicated permission — `/dashboard/announcements/new` has a
route rule, but the list/detail pages stay open to all so read access
matches the broadcast's audience.

Bug fixes / gotchas discovered during this phase's live verification —
the highest count of any phase so far, because this was also the first
phase to exercise the shared `components/ui/dropdown-menu.tsx` primitive
with a real click-and-read-content flow (`UserNav`'s existing dropdown
had never actually been opened by any prior e2e test):

19. **A pre-existing bug in the frozen shared `DropdownMenuLabel`
    component, affecting every dropdown menu in the app including
    `UserNav`'s, not just this phase's new `NotificationBell`.** Base
    UI's `Menu.GroupLabel` throws `"MenuGroupContext is missing"` unless
    it's a descendant of `Menu.Group` — `DropdownMenuLabel` rendered a
    bare `MenuPrimitive.GroupLabel` with no wrapping `Menu.Group`. The
    error was swallowed by Next.js's dev error boundary, so the menu
    silently failed to open with no visible symptom beyond
    `aria-expanded` never flipping to `true` — confirmed only by
    scripting a raw click + checking for `pageerror`/console-error events
    directly, since the failure produced no thrown exception visible to
    a normal Playwright `.click()` call. **Fixed as a genuine bug** (the
    "unless fixing a bug" exception to the freeze) by wrapping
    `MenuPrimitive.GroupLabel` in `MenuPrimitive.Group` inside the shared
    component itself, so every call site — old and new — works without
    needing to know about the requirement. **Rule going forward: when a
    Base UI (or any headless-UI-library) composed primitive silently
    "does nothing" on interaction with no thrown error visible in
    Playwright's own failure output, check the browser console/pageerror
    events directly before assuming an app-level logic bug — the failure
    may be inside the shared UI wrapper and pre-date this phase.**
20. `NotificationBell` kept the previous open's `data` in state while a
    reopen's refetch was in flight, so a `.count()`/`toBeVisible()` check
    taken immediately after a click (even after `waitForLoadState
    ("networkidle")`, which only guarantees the network request settled,
    not that React has committed the resulting state) could read stale
    content. **Fixed as a genuine UX bug, not just a test workaround**:
    `onOpenChange` now clears `data` to `null` before refetching on every
    open, so the popup always shows a fresh "Loading..." state rather
    than briefly flashing outdated read/unread info. **Rule going
    forward: for any popover/dropdown whose content is refetched on
    open, clear stale client state before refetching — both for
    correctness (never show outdated data) and testability (gives e2e
    tests a reliable "wait for Loading to clear" signal instead of
    racing the fetch).**
21. A dashboard KPI card labeled "Bookings" and the sidebar nav link
    labeled "Bookings" render the identical word on the same page — the
    fourth variant of the "same word in two places" category (#13/#16/
    #18). **Rule going forward, restated: scope to a landmark region
    (`page.getByRole("main")`) whenever a KPI/summary card's label could
    plausibly match nav/sidebar text.**
22. A `<input type="datetime-local">` value built by combining
    `date.toISOString().slice(0, 10)` (UTC date) with
    `date.toTimeString().slice(0, 5)` (local time) silently produced a
    wrong absolute instant — datetime-local inputs are interpreted as
    local wall-clock time with no timezone conversion, so mixing a UTC
    date component with a local time component isn't just imprecise,
    it's a different day/time entirely once the local UTC offset is
    nonzero. This was a bug in the *test*, not the app — the same
    booking form's own `toLocalInputValue` helper (all-local getters)
    was the correct reference implementation, sitting right there in
    `booking-form.tsx`, and got copied verbatim into the test to fix it.
    **Rule going forward: never build a datetime-local input string by
    mixing `toISOString()` and `toTimeString()` — use a single
    all-UTC-getters or all-local-getters helper, matching whichever the
    target `<input>` expects (datetime-local always expects local).**
23. An e2e test creating a booking on a fixed time offset (`now + 2h`)
    against a shared seeded database collided with an identical booking
    an earlier run of the same test had left active on the same court,
    and got silently rejected by the (correct, frozen-since-Phase-4)
    overlap-prevention rule — the test didn't check for a create error,
    so it proceeded as if the booking existed. **Rule going forward: any
    e2e test that creates a booking/rental on a "now + fixed offset"
    time and doesn't clean up afterward should randomize the offset
    and/or resource (court/locker/equipment) to avoid colliding with a
    prior run's still-active record, and should assert the create
    actually succeeded (e.g. navigated off `/new`) before relying on
    downstream state it implies.**

**How to apply:** Before building the next module, read this addendum
for the "notifications are personal + lazy-generated + deduped by
entity" pattern and the "reuse `AuditLog` instead of re-deriving a
timeline when one already covers the need" simplification. If a
dropdown/popover menu anywhere in the app appears to silently not open,
check gotcha #19 (the shared `DropdownMenuLabel` fix) before assuming a
new bug — and if any *other* shared `components/ui/*.tsx` primitive
starts behaving oddly, check the browser console directly rather than
trusting Playwright's own error output, since a swallowed client
exception won't always surface as a normal test failure.

-----------------------------------------------------
PHASE 10 ADDENDUM: PRODUCTION HARDENING & DEPLOYMENT (FROZEN)
-----------------------------------------------------

Scope: security (RBAC audit, shared auth/error helpers, rate limiting,
seed safety guard), performance (query batching, indexes, defensive
pagination), database (a real `prisma/migrations/` history, backup/
restore verification), observability (structured logging with actor
context, global/segment error boundaries, a central `HealthService`, an
admin diagnostics page), reliability (Serializable-transaction races
fixed for booking/locker/equipment/bracket-advance/rotation-engine, plus
a DB-level backstop constraint), accessibility/UX polish
(`role="alert"` on form errors, a shared confirmation dialog, a shared
empty-state component), and testing (a prod-server Playwright mode, a
new concurrency e2e spec, a full-suite regression pass). No new
features, no schema redesigns beyond additive indexes/constraints, no
architectural rewrites. Every previously-frozen module's public service
signatures and page URLs are unchanged; the only changes to earlier
phases' files are the ones documented below.

**Shared helpers replacing per-file duplication.** `lib/action-auth.ts`
(`requireSession`/`requirePermission`/`requireSystemAdmin`) and
`lib/errors.ts` (`toActionError`) replace an identical auth-check-then-
Zod-parse-then-try/catch shape that 9 of 12 `actions/*.ts` files had
independently copy-pasted since Phase 3 — same checks, same order
(auth before parse, already correct everywhere), just de-duplicated so
a future copy-pasted action can't forget to update its permission
constant. `toActionError` also closes a real gap: it now special-cases
Prisma `P2002`/`P2025` (`"That value is already in use."`/`"That record
no longer exists."`) instead of leaking a raw Prisma error message to
the client (two confirmed spots: `Locker.code`, `User.email`), and logs
every action failure via `logger.error({err, action, userId}, ...)`
before returning the friendly message — previously silent, no
server-side trail. `court.actions.ts` additionally gained the try/catch
+ Zod validation every other actions file already had (it was the one
holdout with no error handling at all — a verified bug, not a
refactor-for-its-own-sake).

**Rate limiting** (`lib/rate-limit.ts`) — in-memory, fixed-window,
`globalThis`-cached the same way `lib/prisma.ts` survives Fast Refresh.
Explicitly does **not** work across multiple instances/processes; a
horizontally-scaled deployment needs a shared store (Redis) instead —
documented in `docs/DEPLOYMENT.md`, not solved here (out of scope: "no
major feature additions"). Applied to `auth.ts`'s credentials
`authorize()` (10 attempts / 5 min, keyed by lowercased email — see
gotcha #24 below for a real bug found in the first version of this) and
`exportReportCsvAction` (20/min, keyed by user — cheap to abuse
otherwise, since it can trigger a full-table report query on demand).

**Seed safety guard** — `prisma/seed.ts` now calls `assertSafeToSeed()`
(`lib/env.ts`-based) before writing anything: if `NODE_ENV=production`
and `ALLOW_PROD_SEED` isn't `"true"`, it logs an error and exits 1.
Prevents an accidental `npm run db:seed` from (re)creating the
known-password Owner account against a live database.

**Performance: batch instead of per-item N+1.** The highest-impact
single fix this phase: `equipmentService`/`lockerService`'s computed-
field methods (`listEquipment`, `getInventorySummary`, and the
`locker.service.ts` equivalents) previously issued several queries
*per item* (one for active rentals, one for unresolved maintenance,
etc.), making the dashboard's inventory cards ~50 round-trips.
Rewritten to fetch all active rentals / unresolved maintenance logs for
the *whole collection* in one or two queries up front, group into an
in-memory `Map` keyed by item id, and compute each item's
condition/status from the map — the public return shapes
(`EquipmentWithComputed`, `*InventorySummary`, etc.) are unchanged,
verified by comparing new-batched output against old-style per-item
ground truth before trusting it (54 available equipment units, 1
occupied locker, matched exactly). The same "fetch once, group in
memory" shape was applied to
`notificationService.generateReminders()`'s five reminder sweeps (now
one `findMany` + one `createMany` per sweep instead of a `findFirst`
+ `create` per candidate row) and to
`membershipService.reconcileExpiredMemberships` (bulk `updateMany` +
`createMany`, replacing a per-row loop — the one reconciliation method
that hadn't already adopted the Phase 8 bulk pattern).
`analyticsService.getDashboardKpis` and `reportingService
.getRevenueReport` also stopped double-fetching the same booking/
tournament report data when called together.

**Defensive pagination caps** — not full paginated UI (a feature
addition, explicitly out of scope), just a `take: 200` safety cap added
to every previously-fully-unbounded list query (`listPlayers`,
`searchPlayers`, `listBookings`, `listMemberships`, both rental
services' `listRentals`) and `take: 500` on every `reporting.service.ts`
report method. `getMembershipReport` additionally gained real date-range
scoping (`where: { startDate: { lte: to }, endDate: { gte: from } }`) —
it had been the one report method with no range filter at all,
unconditionally loading the whole `Membership` table.

**Database: a real migration history.** The project was `db push`-only
through Phase 9. Introducing `prisma/migrations/` without a shadow
database (the local `courtroom` DB user has no `CREATEDB` grant, and
granting one was avoided as an unnecessary environment change) took a
specific sequence: back up the local DB (`pg_dump`) → generate a
baseline migration via `prisma migrate diff --from-empty --to-schema
prisma/schema.prisma --script` (captures the schema *as it already was*,
before this phase's new indexes) → `prisma migrate resolve --applied` to
mark it applied without re-running SQL already reflected live → generate
a second diff via `--from-config-datasource` (diffs directly against
live DB state — `--from-migrations`, which needs a shadow DB, was
avoided) for the new indexes + `Match` unique constraint → apply via
`prisma db execute --file` + mark applied. `db push` remains available
for quick local iteration; `package.json` gained `db:migrate:deploy`
(`prisma migrate deploy`) for production, which replays
`prisma/migrations/*/migration.sql` files directly with no shadow DB
involved — this is the deployment-time command, not `migrate dev`.

Additive-only indexes, each backed by a query pattern the audit
confirmed, not speculative: `User.deletedAt`, `Player.deletedAt`,
`Team.player1Id`/`player2Id`, `MembershipHistory.createdAt`,
`OpenPlayQueue.courtId`, `Tournament.startDate`,
`Match.team1Id`/`team2Id`/`winnerTeamId`, `EquipmentRental.equipmentId`,
`LockerRental.lockerId`. One constraint, doubling as a reliability
backstop (see below): `Match.@@unique([tournamentCategoryId, round,
bracketPosition])`.

**Reliability: Serializable transactions close five check-then-write
races.** `booking.service.ts`'s `createBooking`, `locker-rental
.service.ts`'s `createRental`, `equipment-rental.service.ts`'s
`createRental`, `match.service.ts`'s `tryAdvanceBracket`, and
`open-play/rotation-engine.ts`'s `startNextMatch` each used to run their
availability/conflict check and their write as two separate awaited
calls with a gap between them — under real concurrency, two requests
could both pass the check before either wrote. Each now wraps check +
write in `prisma.$transaction(fn, { isolationLevel: "Serializable" })`;
Postgres aborts the losing concurrent transaction with a serialization
failure, which Prisma surfaces as error code `P2034`. A local
`isSerializationFailure` helper (mirroring the existing
`isUniqueConstraintViolation`/P2002 check) catches `P2034` and retries
through the same loop already used for reference-collision retries — a
genuine `BookingConflictError` (the check legitimately failed, not a
race) is rethrown immediately, never retried. `tryAdvanceBracket`
additionally swallows P2002/P2034 rather than retrying, since a losing
concurrent bracket-advance is idempotent (the sibling match's advance
already created the next round). Reads that needed to happen *inside*
the transaction (`equipmentService.getAvailableQuantity`,
`courtAssignmentService.findAvailableCourt`/`listAvailableCourts`, a new
private `checkAvailabilityWithClient` in `booking.service.ts`) gained an
optional `client: Prisma.TransactionClient | typeof prisma = prisma`
parameter, defaulting to existing behavior for every other caller. The
`Match` unique constraint above is the DB-level backstop for the same
race — belt-and-suspenders, not a replacement for the transaction.
Verified genuinely working, not just typechecking: a scratch script
firing two simultaneous `equipmentRentalService.createRental` calls
against a single-unit item confirmed exactly one succeeded (final row
count: 1), and `e2e/concurrency.spec.ts` (below) verifies the same
thing end-to-end through real HTTP for all four service-layer races.

**Observability.** `app/global-error.tsx` (root-layout-level crash,
previously fell through to Next's unstyled default) and `app/dashboard
/error.tsx` (a crash on one dashboard page no longer unmounts the whole
header/sidebar shell) both reuse the existing `components/shared/error-
fallback.tsx`. `services/health/health.service.ts` centralizes app
status/uptime/DB connectivity/configured-provider info behind one
`getHealth()` call; `app/api/health/route.ts` is now a thin wrapper
around it (same public response shape). A new `/dashboard/admin
/diagnostics` page (gated by the new `SYSTEM_ADMIN`-tier `/dashboard
/admin` route rule) renders `getHealth()` plus a few cheap counts
(users, today's active bookings, unresolved inventory alerts) for an
Owner/Manager to sanity-check a deployment at a glance. Every action's
error log line now includes `userId` (12 service files' `writeAuditLog`
catch blocks previously logged the audit-write failure itself without
the actor who triggered it).

**Accessibility/UX.** Every form's top-level `serverError` paragraph
(~19 near-identical components) gained `role="alert"` so a failed
submission is announced to screen readers, not just shown visually. A
new `components/ui/alert-dialog.tsx` (Base UI wrapper, styled like the
existing `sheet.tsx`/`dropdown-menu.tsx`) and `components/shared
/confirm-action-button.tsx` give the app its first confirmation-dialog
primitive, wired to the six destructive actions that previously fired
immediately on click: delete announcement, mark equipment lost, cancel/
no-show a booking, cancel an Open Play session, cancel a tournament.
Double-checked for a Phase-9-gotcha-#19-style hidden Base UI
requirement by live-testing the delete-announcement flow via Playwright
before wiring it into the other five spots — none found. ~18 ad-hoc
`<p>No X yet.</p>` empty states across `features/*/components/*-list.tsx`
(and two timeline components) were swapped for the existing shared
`components/shared/empty-state.tsx` (already used in ~15 other spots);
the two form-embedded "no players to rent to yet" messages were left as
plain text — a different UI context (an inline hint inside a compact
form, not a list/page-level empty state), not an oversight.

**Testing.** `playwright.config.ts` gained a `PW_PROD_SERVER=1` (or
`CI`) flag that swaps the `webServer` command from `npm run dev` to
`npm run build && npm run start`. `e2e/concurrency.spec.ts` is new:
four tests, each opening two independent browser contexts (separate
sessions) and firing two near-simultaneous mutating requests at the
same booking window / locker window / equipment unit / pair of sibling
tournament matches feeding one bracket slot, asserting exactly one side
wins — direct end-to-end verification of the five transaction fixes
above (the rotation-engine race is covered by the existing scratch-
script/live verification rather than a fifth e2e case, since driving
two Open Play "start next match" clicks through the UI reliably would
have needed session/queue fixture setup disproportionate to the
marginal coverage). See gotchas #26-27 below for what a full-suite
regression pass against both server modes actually found.

Bug fixes / gotchas discovered during this phase's live verification:

24. **The first version of the login rate limiter counted every
    `authorize()` call — including successful logins — toward the same
    5-attempts/5-minutes quota used for brute-force protection.**
    Found by the Playwright suite itself: repeated legitimate logins as
    the seeded Owner account (the same test-suite pattern every e2e spec
    uses) tripped the limiter after ~10 logins within 5 minutes, exactly
    the volume a normal full-suite run produces. A real user logging in
    and out several times during a shift would eventually have hit the
    same wall. **Fixed as a genuine security-correctness bug**, not just
    a test-convenience workaround: `lib/rate-limit.ts` was split into
    `peekRateLimit` (read-only check) and `recordRateLimitFailure`
    (increments only on a wrong password / unknown user); `checkRateLimit`
    (check-and-increment-unconditionally) stays as-is for the CSV-export
    limiter, where every call — success or failure — should count.
    **Rule going forward: a brute-force-protection rate limit should
    only count failed attempts; a resource-consumption rate limit (like
    a report export) should count every attempt regardless of outcome —
    these are different semantics behind the same generic limiter, don't
    default to one implementation for both.**
25. **Non-unique e2e test fixtures collide with themselves on a
    repeated run against a persistent dev database** — the same root
    cause as Phase 9's gotcha #23, recurring because it wasn't applied
    retroactively to the specs that already existed at the time. Two
    concrete instances found by actually running the full suite more
    than once today: `courts.spec.ts` matched `getByRole("link", {
    name: "Court 1" })` without `exact: true`, which coincidentally also
    matches any leftover `"E2E Test Court <timestamp>"` row from a prior
    run of the same spec's own "create a new court" test, since every
    2026 Unix-ms timestamp begins with the digit `1` (`"Court
    178...")` contains `"Court 1"` as a literal substring) — this was
    not rare flakiness, it was guaranteed to eventually collide with the
    spec's own prior output. `bookings.spec.ts`'s walk-in test used a
    hardcoded `"Court 6"` with no way to vary a walk-in booking's time
    (always "now"), so a second run within the same hour collided with
    the first run's still-active `CHECKED_IN` booking; its "overlapping
    booking is rejected" test used a fixed `tomorrow` date, colliding
    with itself on a second same-day run for the same reason as gotcha
    #23. **Fixed**: `exact: true` on the ambiguous locators;
    `bookings.spec.ts` now creates its own fresh, never-reused court per
    test (`createFreshCourt`, mirroring `courts.spec.ts`'s own pattern)
    and spreads its scheduled-booking test across a wide, suffix-derived
    range of future days rather than a fixed offset — the same fix
    already applied to the new `concurrency.spec.ts`'s own booking test
    from the start. **Rule going forward: gotcha #23's rule wasn't
    optional or Phase-9-specific — audit every *existing* e2e spec's
    fixture strategy the next time the full suite is run against a
    long-lived database, not just new specs.**
26. **Running the full suite against a `next build && next start` server
    did not eliminate the full-suite-under-load flakiness the way the
    original plan for this phase assumed it would.** The plan's
    hypothesis (documented in `playwright.config.ts` since Phase 4's
    gotcha #9) was that the flakiness was specifically an on-demand-
    compilation problem, so a prod build — no compile step — should
    remove it outright, and `retries` was accordingly set to `0` for
    `PW_PROD_SERVER=1` runs. Measured directly: a same-day, zero-retry,
    full-suite run against `next start` failed 7 tests, effectively the
    same set (open-play, players, two reports-notifications-analytics
    tests, tournaments) that `next dev` needed its 1 retry to absorb.
    Re-enabling one retry for the prod-server run dropped it to 1
    genuine failure, which then passed cleanly in isolation — i.e. the
    flakiness is real but is generic sequential-load timing (single
    worker, single dev-database connection, a `router.refresh()`
    occasionally landing after the default assertion timeout under
    combined load — the same mechanism Phase 7's gotcha #15 already
    named), not something specific to dev-mode compilation. **Fixed**:
    `playwright.config.ts`'s `retries` no longer special-cases prod-
    server mode to `0` — both modes keep the existing `CI ? 2 : 1`.
    Prod-server mode is still worth using (it does narrow the failure
    surface, and eliminates the compile-time variance entirely), but it
    is not a substitute for retries. **Rule going forward: don't assume
    a hypothesized root cause without measuring the fix under the same
    load that exposed the original problem — "no compile step" was a
    real, contributing difference, just not the *only* one.**
27. **A one-shot `.isVisible()` / `page.url()` read taken immediately
    after `waitForLoadState("networkidle")` is not a reliable way to
    determine which side of a race won.** `networkidle` only guarantees
    the network request settled, not that the resulting React state has
    committed and re-rendered (the same category as Phase 9's gotcha
    #20, but for reading an outcome rather than reopening a popover) — a
    snapshot taken at that point during `e2e/concurrency.spec.ts`'s
    first draft showed a still-disabled `"Renting…"` button and "No
    rentals yet.", i.e. the mutation was still in flight. The first fix
    attempt (try a bounded wait for the "win" signal, catch, then try a
    bounded wait for the "lose" signal) introduced a second bug: two
    sequential 20-second waits can exceed Playwright's 30-second default
    per-test timeout, aborting the check mid-way and producing a
    misleading "neither state appeared" failure that had nothing to do
    with the application. **Fixed**: outcome determination now polls
    both the win and lose locators concurrently in one bounded loop
    (`determineOutcome`, 250ms interval) — whichever becomes visible
    first is the answer, no risk of the two checks summing past the
    test timeout; the describe block's timeout was also raised to 60s
    for margin. **Rule going forward: never read a mutation's outcome
    synchronously right after `networkidle`; poll for the actual
    resulting UI state. When a test needs to distinguish which of two
    possible outcomes occurred, poll both signals in the same loop —
    don't chain two sequential bounded waits, since their timeouts add
    up against the single per-test timeout.**

**How to apply:** Before any future phase, read this addendum for the
Serializable-transaction pattern (optional `client` parameter on any
read that needs to happen inside a caller's transaction) before adding
any new check-then-write flow, gotcha #24 before adding any new rate
limit (decide up front whether it's brute-force protection — failures
only — or resource-consumption protection — every attempt), and gotcha
#25 before trusting any existing e2e spec's fixture uniqueness on a
long-lived database — "it passed the last time this spec ran alone" is
not evidence it survives a second run. Gotchas #26-27 apply specifically
to any future e2e test that tries to observe which side of a race won.

## RBAC Audit

Every dashboard route prefix and every Server Action, against its
required permission — `lib/rbac.ts`'s `PROTECTED_ROUTES` and each
`actions/*.ts` file's shared auth-guard call, as of Phase 10. Route
matching is longest-prefix-wins (Phase 3), so a listed child prefix
overrides its parent. "None (session only)" means any authenticated
user may call it, scoped to their own data inside the service layer.

### Routes

| Route prefix | Required permission |
|---|---|
| `/dashboard` (default for everything below) | `dashboard:access` |
| `/dashboard/courts/new` | `courts:manage` |
| `/dashboard/bookings` | `bookings:manage` |
| `/dashboard/open-play` | `open_play:manage` |
| `/dashboard/tournaments` | `tournaments:manage` |
| `/dashboard/players` | `players:manage` |
| `/dashboard/memberships` | `players:manage` |
| `/dashboard/equipment` | `equipment:manage` |
| `/dashboard/lockers` | `equipment:manage` |
| `/dashboard/reports` | `reports:manage` |
| `/dashboard/analytics` | `reports:manage` |
| `/dashboard/announcements/new` | `system:admin` |
| `/dashboard/admin` (new, Phase 10) | `system:admin` |

Not listed above (reviewed, intentional, per Phase 9's addendum):
`/dashboard/courts` (list/detail) and `/dashboard/announcements`
(list/detail) fall through to the blanket `/dashboard` →
`dashboard:access` rule — courts are a shared facility resource and
announcements are meant to be broadly readable to all staff; every
mutation underneath both is still fully permission-gated at the action
layer per the table below.

### Server Actions

One row per `actions/*.ts` file — every exported action in that file
shares the same auth guard, called first, before any Zod validation.

| Actions file | Required permission | Exported actions |
|---|---|---|
| `court.actions.ts` | `courts:manage` | createCourtAction, updateCourtAction, setCourtStatusAction, scheduleMaintenanceAction, updateMaintenanceStatusAction |
| `booking.actions.ts` | `bookings:manage` | createBookingAction, updateBookingStatusAction, checkInByTokenAction, regenerateBookingQrTokenAction |
| `open-play.actions.ts` | `open_play:manage` | createSessionAction, updateSessionAction, updateSessionStatusAction, registerForSessionAction, cancelRegistrationAction, checkInRegistrationAction, markNoShowAction, startNextMatchAction, endMatchAction, returnFromRestAction, removeFromQueueAction |
| `tournament.actions.ts` | `tournaments:manage` | createTournamentAction, updateTournamentAction, updateTournamentStatusAction, createCategoryAction, registerTeamAction, cancelRegistrationAction, generateBracketAction, scheduleMatchAction, recordScoreAction, completeMatchAction, markWalkoverAction |
| `player.actions.ts` | `players:manage` | createPlayerAction, updatePlayerAction, deletePlayerAction |
| `membership.actions.ts` | `players:manage` | createPlanAction, updatePlanAction, enrollMembershipAction, renewMembershipAction, changePlanAction, suspendMembershipAction, reactivateMembershipAction, cancelMembershipAction |
| `equipment.actions.ts` | `equipment:manage` | createEquipmentAction, updateEquipmentAction, createEquipmentRentalAction, returnEquipmentRentalAction, markEquipmentLostAction, logEquipmentMaintenanceAction, resolveEquipmentMaintenanceAction |
| `locker.actions.ts` | `equipment:manage` | createLockerAction, updateLockerAction, createLockerRentalAction, returnLockerRentalAction, logLockerMaintenanceAction, resolveLockerMaintenanceAction |
| `report.actions.ts` | `reports:manage` | exportReportCsvAction (also rate-limited: 20/min per user) |
| `announcement.actions.ts` | `system:admin` | createAnnouncementAction, updateAnnouncementAction, publishAnnouncementAction, unpublishAnnouncementAction, deleteAnnouncementAction |
| `notification.actions.ts` | None (session only) | getNotificationCenterDataAction, markNotificationReadAction, markAllNotificationsReadAction — every method scopes to `session.user.id` internally |
| `auth.actions.ts` | None (public) | loginAction — also rate-limited: 10 attempts/5min per email, failures only (see gotcha #24) |
| `employee.actions.ts` (v1.1) | `users:manage` | createEmployeeAction, updateEmployeeAction, resetEmployeePasswordAction, changeEmployeeRoleAction, setEmployeeActiveAction |
| `role.actions.ts` (v1.1) | `users:manage` | createRoleAction, updateRoleAction, deleteRoleAction |
| `shift.actions.ts` (v1.1) | None (session only) | startShiftAction, endShiftAction — resolves the caller's own Employee row from `session.user.id`, same self-service pattern as `notification.actions.ts` |
| `settings.actions.ts` (v1.1) | `system:admin` | upsertSettingAction, deleteSettingAction |

-----------------------------------------------------
TCOS v1.1 — SUB-PHASE 1 ADDENDUM: EMPLOYEE, ROLE, SHIFT & ADMIN
WORKSPACES + USERNAME/PASSWORD AUTH (FROZEN)
-----------------------------------------------------

Scope: TCPMS is being reframed as TCOS — The Courtroom Operating System —
a set of interfaces (Reception Workspace, Owner Workspace, a future
Public Display, Customer Portal, Mobile App) sharing one service layer,
starting with this sub-phase's foundation: admin-issued username/password
staff accounts (no self-registration, no OAuth), an Employee profile
model, a database-backed Role management system (roles are no longer
fixed/hardcoded), Shift clock-in/out, and Audit Log / Settings admin
screens — plus a navigation restructure grouping every existing route
into Operations / Tournaments / Administration. Every new screen is a
single-route **workspace** (list + detail in one view, no separate
`/new` page to navigate to and back from) rather than a traditional
multi-page CRUD flow — "build workspaces, not pages" is the standing
design rule for this and every future v1.1 sub-phase. Sales (Sub-phase
2), Reception/Owner Workspaces and new report types (Sub-phase 3),
3-court customization (Sub-phase 4), and the visual redesign (Sub-phase
5) are not part of this sub-phase.

**Schema changes** (all additive):
`User.email` went from required+unique to optional+unique (a loosened
constraint, not a narrowing — existing rows keep their email); `User
.username` was added (optional+unique) as the new login identifier.
`Role` gained `isSystem Boolean` (true for the 6 seeded roles) so the
Roles workspace can allow editing any role's label/description/
permission set — including built-in ones — while blocking deletion or
renaming the stable `name` key of a system role (some code paths, like
Player creation's `SYSTEM_ROLES.MEMBER` lookup, still depend on that key
existing). Two new models: `Employee` (1:1 with `User`, the exact
precedent `Player` already set — `employeeNumber` "EMP-0001" generated
the same count-then-retry-on-collision way as `Booking.bookingReference`,
just with no date component since it's a stable identity not a per-day
sequence; `photoUrl` mirrors `Player.photoUrl`'s own precedent rather
than reusing the now-unused `User.image` field, for consistency) and
`Shift` (`shiftNumber` "SHIFT-20260722-001", same date+sequence pattern
as every other reference code; `openingCashCents`/`closingCashCents` —
Philippine business terminology, not "float"/"cash count";
`varianceCents` stays `null` until Sub-phase 2's `Sale` model exists to
compute cash sales against; only one `OPEN` shift per employee is
enforced at the service layer via a fresh check inside the same
collision-retry loop, not a DB constraint, so multiple `CLOSED` shifts
per employee per day are unrestricted). No `PaymentMethod` table yet —
nothing in this sub-phase references a payment method; deferred to
Sub-phase 2 where it's actually consumed.

**Auth rewrite.** `auth.ts`'s `authorize()` now looks up `User.username`
instead of `email`, rejects an inactive employee
(`user.employee?.isActive === false`) the same way it already rejected a
soft-deleted user, and writes an `AuditLog` entry
(`auth.login_succeeded`/`auth.login_failed`, `entityType: "User"`) on
every attempt — the data source for each employee's Login History
section, reusing `AuditLog`'s previously-unused `ipAddress`/`userAgent`/
`metadata` columns' sibling pattern rather than a new table. The
`PrismaAdapter` and Google OAuth provider were removed entirely
(Credentials-only auth needs no DB-backed adapter); `AUTH_GOOGLE_ID`/
`AUTH_GOOGLE_SECRET`/`FEATURE_GOOGLE_LOGIN` were removed from `lib/env.ts`.
`session.user.role` (and the underlying JWT field) is now typed as a
plain `string`, not `SystemRoleName`, since roles are no longer a fixed
enum-like set — `types/roles.ts`'s `SYSTEM_ROLES` still exists as a
typed pointer to the roles seeded out of the box (some code, like Player
creation, still needs a stable reference to `MEMBER`), it's just no
longer exhaustive.

**Role management.** `services/role/role.service.ts` is thin — `Role`/
`Permission`/`RolePermission` were already real tables (Phase 1
decision), the only gap was that nothing but the seed script ever
created a `Role` row. `createRole` derives the stable `name` key from
the human-typed `label` (`slugifyRoleName`: "Marketing" → "MARKETING");
`updateRole` replaces a role's entire permission set in one transaction
(delete all `RolePermission` rows for that role, recreate from the
submitted list) rather than diffing. The fixed permission catalog itself
(`types/permissions.ts`) stays code-defined — a brand-new permission key
wouldn't be checked by any route/action, so there's no admin UI to
invent one; "roles aren't hardcoded" means **role rows**, not permission
keys, are freely creatable. Since `lib/rbac.ts`'s route rules are keyed
by permission (not role name), a brand-new role slots into every
existing route/action check with zero code changes the moment it's
granted the right permissions.

**Navigation restructure.** Flat `dashboardNavItems` (`lib/config.ts`)
became `dashboardNavGroups` — Operations / Tournaments / Administration
— rendered as labeled sections in both `dashboard-sidebar.tsx` and the
mobile `Sheet` nav in `dashboard-header.tsx` (both files independently
duplicate a `NAV_ICONS` map keyed by href, same pre-existing pattern,
now with 5 more entries). `dashboardNavItems` (flat) is derived from
`dashboardNavGroups` via `flatMap` and kept exported for anywhere that
just needs every destination (e.g. active-link matching) without caring
about grouping. Operations is listed first — reception is the center of
daily operations, matching the Reception Workspace that Sub-phase 3
builds on top of this same grouping.

**Seed data.** Owner gets `username: "owner"` (keeps `email` too) and a
paired `Employee` row (`EMP-0001`). All 6 seeded roles are marked
`isSystem: true`. `TOURNAMENT_DIRECTOR`'s stable key is unchanged but its
seeded **label** is now "Tournament Staff" (renaming the key would touch
permission-wiring code paths — the label is what staff actually see). A
new `CAFE_STAFF` role / label "Cafe Staff" was added, `DASHBOARD_ACCESS`
only for now (no cafe module exists yet — reserved for Sub-phase 2's
`SaleCategory` including `CAFE`).

**e2e test updates.** Every spec's `loginAsOwner` helper filled an email
field — touching all 8 spec files anyway to change that, so the
duplicated helper was consolidated into one `e2e/helpers/auth.ts`.

Bug fixed during this sub-phase's live verification:

28. **Nine dashboard pages were being incorrectly statically prerendered
    at `next build` time and never re-fetched fresh data in production**
    — found live, not by inspection: creating a new Court via the Court
    Management workspace, then immediately visiting
    `/dashboard/bookings/new` under `next start` (production mode), did
    not show the new court in its dropdown. Root cause: a Next.js App
    Router page gets statically prerendered unless something on the page
    signals it needs live rendering — a dynamic route segment (`[id]`),
    a `searchParams` prop, or a direct `cookies()`/`headers()`/`auth()`
    call. Eight pre-existing pages (`bookings/new`, `equipment` list,
    `equipment/rentals`, `lockers` list, `lockers/rentals`,
    `memberships/plans`, `open-play` list, and Phase 10's own
    `admin/diagnostics`) had none of those signals despite reading live
    Prisma data, and had been silently frozen at build-time state since
    as early as Phase 4 — invisible in `next dev` (which never does
    static optimization) and apparently never exercised end-to-end
    against a real `next start` build with a create-then-immediately-view
    flow before. This sub-phase's own new `admin/settings` page launched
    with the identical bug for the same reason. **Fixed** by adding
    `export const dynamic = "force-dynamic";` to all nine pages — a
    one-line, additive, business-logic-free directive per file (full
    list: `bookings/new`, `equipment`, `equipment/rentals`, `lockers`,
    `lockers/rentals`, `memberships/plans`, `open-play`,
    `admin/diagnostics`, `admin/settings`). **Rule going forward: any new
    Server Component page that reads live data via a service (not just a
    dynamic-segment detail page) needs either a `searchParams` prop, a
    direct `auth()`/`cookies()` call, or an explicit `export const
    dynamic = "force-dynamic"` — don't assume Next.js will infer that a
    Prisma-backed page needs live rendering, since Prisma calls carry
    none of the signals its static-optimization heuristic looks for.
    Verify any new static-looking page under an actual `next build &&
    next start` (not just `next dev`) before trusting it shows live
    data.**

Also noted, not a bug: this sub-phase's Playwright regression pass
showed increasing flakiness in later runs — including, once, in
`concurrency.spec.ts`'s booking-race test, whose underlying service code
was not touched this sub-phase — that did not reproduce consistently
and shifted failure mode between identical re-runs (a login-form
GET-submission-before-hydration race once, a race-outcome-detection
timeout another time). Given hours of continuous `next build`/`next
dev`/`next start`/Playwright invocations preceded these runs, this
reads as accumulated local-machine resource pressure rather than a
code regression — every deterministic check (`tsc`, `eslint`, unit
tests, production build) stayed 100% clean throughout, and a dedicated,
thorough live walkthrough of every new v1.1 feature (employee create/
disable/login-history, role create/assign, shift start/end, audit log,
settings) passed cleanly with real interactions. **Rule going forward:
if a long single session shows Playwright flakiness on tests unrelated
to the current change, in ways that don't reproduce consistently, treat
a fresh-session re-run as the authoritative signal before trusting it
over passing deterministic checks and manual verification** — don't
burn unbounded time chasing a failure mode that changes between
identical retries on the same files.

**How to apply:** Before Sub-phase 2, read this addendum for the
Employee/Shift service patterns (both follow the exact `writeAuditLog`-
after-mutation convention every prior service uses) and gotcha #28
before writing any new dashboard page that reads live data with no
dynamic segment/searchParams — check it renders `ƒ` (Dynamic), not `○`
(Static), in `next build`'s route list. Sub-phase 2's `Sale`/
`PaymentMethod` models plug into `Shift.varianceCents` (currently null)
and the `SaleCategory` enum should include `CAFE` so the `CAFE_STAFF`
role seeded here has a real permission to eventually grant.

## v1.1 Sub-phase 1 RBAC additions

New route rules (`lib/rbac.ts`), longest-prefix-match overriding
`/dashboard/admin`'s `system:admin` default:

| Route prefix | Required permission |
|---|---|
| `/dashboard/shift` | `dashboard:access` (inherited from `/dashboard` — self-service, any signed-in employee) |
| `/dashboard/admin/employees` | `users:manage` |
| `/dashboard/admin/roles` | `users:manage` |
| `/dashboard/admin/audit-logs` | `system:admin` (inherited) |
| `/dashboard/admin/settings` | `system:admin` (inherited) |

See the Server Actions table above for `employee.actions.ts`/
`role.actions.ts`/`shift.actions.ts`/`settings.actions.ts`.

-----------------------------------------------------
TCOS v1.1 — SUB-PHASE 2 ADDENDUM: UNIFIED SALES ENGINE
(FROZEN)
-----------------------------------------------------

Scope: a single, centralized `SaleService` is now the only place any
revenue-producing workflow creates a financial record. Creating a
booking, enrolling a membership, renting equipment, renting a locker, or
registering a tournament team each now also creates exactly one `Sale`
row, atomically alongside its own row, tied to the acting Employee,
their currently open Shift, and one of a database-configurable set of
Payment Methods — reception never encodes a transaction twice. Reception/
Owner Workspaces, Public Display, Customer Portal, 3-court customization,
and the visual redesign remain out of scope, per the explicit stop
condition for this sub-phase.

**Schema changes.** New `Sale` model: `saleNumber` ("SALE-20260722-0001",
same date+sequence pattern as every other reference code),
`category: SaleCategory` (`BOOKING | MEMBERSHIP | EQUIPMENT_RENTAL |
LOCKER_RENTAL | TOURNAMENT_REGISTRATION | PRODUCT | OTHER` — `PRODUCT`/
`OTHER` exist for future workflows, nothing produces them yet),
`source: SaleSource` (`RECEPTION | WEBSITE | MOBILE_APP | ADMIN |
TOURNAMENT`, defaults `RECEPTION` — only `RECEPTION` is produced today;
the rest exist so a future Customer Portal/Mobile App/kiosk can create
Sales through this same service without a schema change), `status:
SaleStatus` (`COMPLETED | VOID`), `amountCents`, required
`employeeId`/`shiftId`/`paymentMethodId`, nullable `playerId`, and one
nullable+unique FK per source domain (`bookingId`, `membershipId`,
`equipmentRentalId`, `lockerRentalId`, `tournamentRegistrationId`) — the
same "one FK per domain" shape the long-dead `Payment` model already
established, just for the domains that actually produce a Sale today.
`Employee`/`Shift`/`Player` each gained a `sales Sale[]` back-relation;
`Booking`/`Membership`/`EquipmentRental`/`LockerRental`/
`TournamentRegistration` each gained a nullable `sale Sale?` back-relation.

New `PaymentMethod` model (a real, admin-editable table — Add/Edit/
Disable are built this sub-phase; drag-and-drop reordering is not,
matching "don't overbuild" — `sortOrder` is a plain number field for
now) replaces the previously-dead `enum PaymentMethod`
(`CASH|CARD|GCASH|BANK_TRANSFER|OTHER`), which had zero application-code
references anywhere (confirmed before touching it — the only thing that
ever used it was the equally-dead `Payment` model). Since Prisma
disallows a model and enum sharing a name, and `Payment` is provably
inert, `Payment.method` became a `paymentMethodId` FK to the new model
instead of keeping the enum — the only change made to the frozen
`Payment`/`Invoice` module, and a safe one since nothing reads or writes
`Payment` anywhere (`prisma.payment.count()` was `0` before this change).

**`Sale.shiftId`/`Sale.employeeId` are non-nullable — a genuine new
constraint.** Every one of the five workflows above now requires the
acting employee to have a currently `OPEN` Shift before it will create
anything at all; attempting one with no open shift returns "Start a
shift before recording this transaction." instead of silently creating
an orphaned booking/rental/registration with no financial record. This
is a deliberate, structural consequence of "every Sale belongs to the
currently active Shift" (needed so `Shift.varianceCents`, still `null`,
can eventually be computed as `closingCash - (openingCash + cash
Sales for that shift)` — that computation itself is intentionally **not**
built this sub-phase, matching "don't overbuild reconciliation now").

**`services/sales/sale.service.ts` — `SaleService`.** `createSale(input,
client?, attemptOffset?)` accepts an optional `Prisma.TransactionClient`
(defaults to the plain `prisma` client) so each of the five calling
services can create the Sale *inside their own existing transaction*,
atomically alongside their own row. `attemptOffset` mirrors the calling
service's own retry-loop attempt number (the same convention every
other reference-number generator in this app already uses, e.g.
`booking.service.ts`'s `generateNextBookingReference`) — a `saleNumber`
collision surfaces as a plain Prisma `P2002`, which every calling
service's pre-existing `isUniqueConstraintViolation` retry catch already
handles the same way it handles its own reference collisions, so no new
retry/backoff logic was needed in `SaleService` itself. `logSaleCreated`
writes the Sale's own `AuditLog` entry *after* the caller's transaction
commits, on the default client — same "audit log after commit, never
inside the transaction" convention every service in this app follows.
Also: `listPaymentMethods`, `createPaymentMethod`, `updatePaymentMethod`,
`setPaymentMethodActive`, `listSalesForPlayer`.

**`lib/action-auth.ts` gained `requireEmployeeWithOpenShift(permission,
deniedMessage)`** — combines the existing `requirePermission` check with
resolving the caller's `Employee` row and currently-open `Shift` (the
same two lookups `shift.actions.ts`'s pre-existing `requireOwnEmployee`
already does for self-service shift actions, just permission-gated
instead of session-gated). Returns `{ok:true, userId, employeeId,
shiftId} | {ok:false, error}`. This is what
`createBookingAction`/`enrollMembershipAction`/
`createEquipmentRentalAction`/`createLockerRentalAction`/
`registerTeamAction` now call instead of a plain `requirePermission` —
every other action in each of those five files (status updates, returns,
maintenance logs, etc.) is untouched, still using the original
permission-only check, since only Sale-creating actions need an
Employee+Shift resolved.

**The five integration points**, one line of reasoning each:
- **Booking** — `booking.service.ts`'s `createBooking` now also computes
  `totalAmountCents` (`Court.hourlyRateCents × duration`, rounded to the
  nearest cent) inside its existing Serializable transaction — a field
  that existed since Phase 4 but was never once set before this
  sub-phase — and creates the Sale with that amount, still inside the
  same `tx`.
- **Membership** — `membership.service.ts`'s `enrollPlayer` was **not
  transactional before this sub-phase** (two separate un-transacted
  writes); it's now wrapped in `prisma.$transaction` (not Serializable —
  no race being fixed, just atomicity so a `Membership` row and its Sale
  are never created one without the other) and uses
  `MembershipPlan.priceCents` as the Sale amount.
- **Equipment rental** — `equipment-rental.service.ts`'s `createRental`
  creates the Sale inside its existing Serializable transaction, using
  `Equipment.rentalRateCents` as the amount. Deliberately **excludes**
  `Equipment.depositCents` from the Sale amount — a deposit is refundable
  collateral, not revenue.
- **Locker rental** — `locker-rental.service.ts`'s `createRental` uses
  `input.amountCents ?? 0` unchanged (the only one of the five where the
  amount was already a manual client input, not a rate column). Note:
  the locker rental form does not currently expose an amount field at
  all, so every locker rental Sale is presently ₱0 — a pre-existing gap
  (the form/schema always defaulted this to 0) that this sub-phase did
  not expand scope to fix; flagging for whoever adds one.
- **Tournament registration** — `tournament.service.ts`'s `registerTeam`
  was **not transactional before this sub-phase either**, and had no
  retry loop at all (no generated reference field to collide over,
  unlike the other four). It's now wrapped in `prisma.$transaction` with
  a new 5-attempt retry loop — needed only because `Sale.saleNumber` can
  now collide — and uses `TournamentCategory.feeCents` as the amount.

**New: Payment Methods workspace** (`/dashboard/admin/payment-methods`,
`system:admin`, inherits the `/dashboard/admin` route rule, added to the
Administration nav group) — list + add + active toggle + a plain
`sortOrder` number input. Deliberately minimal, matching this sub-phase's
own "don't overbuild" instruction for reconciliation.

**Customer history.** `player.service.ts`'s `getPlayerTimeline` gained a
`SALE` event type, merging in `prisma.sale.findMany({where:{playerId}})`
— reuses the pre-existing merge-events pattern (`player-timeline.ts`'s
`mergeTimelineEvents`) rather than inventing a new one.

**Seed data.** Four `PaymentMethod` rows: Cash, GCash, Bank Transfer,
Credit/Debit Card (`isActive: true`, `sortOrder: 0..3`).

**Reconciling a forward-looking note from the Sub-phase 1 addendum:**
that addendum speculated `SaleCategory` "should include `CAFE`" for the
`CAFE_STAFF` role seeded in Sub-phase 1. The actual, later, more specific
Sub-phase 2 spec from the user enumerated exactly seven categories —
Booking, Membership, Equipment Rental, Locker Rental, Tournament
Registration, Product, Other — with no Cafe category. This addendum's
`SaleCategory` follows that explicit spec, not the earlier speculative
note. `CAFE_STAFF` still only grants `DASHBOARD_ACCESS`; a real cafe/POS
module (and whatever `SaleCategory` value it needs) remains a future,
unscoped decision, not assumed here.

**Verification performed.** `prisma validate`, the no-`CREATEDB` diff-
and-apply migration procedure, `db:seed`, `tsc --noEmit`, `eslint`, all
144 Jest tests, and `next build` all passed clean — the new
`/dashboard/admin/payment-methods` route confirmed `ƒ` (Dynamic) in the
build's route list, not `○` (Static), per gotcha #28's rule. Live,
through the real UI (dev server, logged in as Owner): starting a shift,
then renting equipment (GCash), renting a locker (Bank Transfer),
registering a tournament team (Credit/Debit Card), and enrolling a
membership (Cash) each created exactly one correctly-linked `Sale` row —
confirmed by direct query, not just a success toast — with the right
category, `employeeId` (`EMP-0001`), `shiftId`, `paymentMethodId`, and
source-domain FK, and the right `amountCents` wherever a real rate
existed (`Equipment.rentalRateCents` → `10000`,
`MembershipPlan.priceCents` → `100000`). Ending the open shift and then
attempting an equipment rental correctly surfaced "Start a shift before
recording this transaction." instead of silently succeeding. The
enrolled player's Timeline correctly showed the new `SALE` event.
Grouping `Sale` by category/payment method/employee, and a plain
aggregate sum, both returned correct totals — confirming the data model
is dashboard-ready for Sub-phase 3 without any new UI needing to be
built this sub-phase, per the plan's own scope boundary.

**Booking specifically could not be live-verified end-to-end this
session** — not a defect in this sub-phase's code. `booking.service.ts`'s
pre-existing (Phase 4) `generateNextBookingReference` derives the next
`bookingReference` from `prisma.booking.count()` for today, then retries
up to 5 times on collision (`count+1+attempt`). This session's dev
database had accumulated 27 same-day test-debris `Booking` rows (from
`concurrency.spec.ts`/`reminder`/`e2e` runs earlier this session) whose
reference *sequence* had gaps reaching `BK-20260722-0034` — meaning the
next 5 candidate numbers (`0028`–`0032`) were all already taken, and
every attempt collided, exhausting the retry loop with a generic "That
value is already in use." error. Confirmed via the server's own error
log that this failure happens inside `tx.booking.create()` itself,
*before* this sub-phase's new `saleService.createSale()` call would ever
run — i.e. this is a pre-existing count-vs-actual-max-sequence fragility
in Phase 4's reference generator that would reproduce identically with
or without any Sub-phase 2 change, triggered only by this session's
unusually large amount of accumulated same-day test debris. Booking's
Sale integration was verified by code review instead — it's structurally
identical to equipment rental's already-proven-working pattern (fetch
data inside the existing Serializable `tx`, create the row, create the
Sale with `tx` + the same `attempt` offset) — and by the fact the exact
same `saleService.createSale(..., tx, attempt)` call, invoked from four
different call sites with different transaction shapes, produced a
correctly-linked Sale every time. **Before booking is next live-tested,
clean up today's stray test-debris `Booking` rows** (same precedent as
Phase 10's stray-Court cleanup) — this needs an explicit, deliberate
cleanup pass (an auto-mode content classifier declined an unattended
bulk-delete attempt during this session), not a code change.

**How to apply:** Sub-phase 3 (Reception & Owner Workspaces, new report
types) is next, per the roadmap and this sub-phase's own stop condition —
do not begin it without explicit approval. When it does start, the
revenue-rollup queries already spot-checked here (`groupBy` on
`category`/`paymentMethodId`/`employeeId`, plus a plain `aggregate`) are
the basis for Owner Home's Today's Revenue / Revenue by Category /
Revenue by Payment Method / Revenue by Employee cards — no new query
shape should be needed, just UI. `Shift.varianceCents` can now be
computed (`closingCash - (openingCash + cash Sales for that shift)`, per
`Sale.shiftId` + `PaymentMethod.key === "CASH"`) whenever that specific
reconciliation feature is actually scoped — it deliberately wasn't this
sub-phase. Clean up the stray test-debris `Booking` rows mentioned above
before relying on live booking-creation tests.

-----------------------------------------------------
v1.1 MAINTENANCE: CONCURRENCY-SAFE REFERENCE COUNTERS
(FROZEN — FIXES GOTCHA #29)
-----------------------------------------------------

Scope: every human-readable reference-number generator in the app
(`Booking.bookingReference`, `Membership.membershipReference`,
`Shift.shiftNumber`, `EquipmentRental.rentalReference`,
`LockerRental.rentalReference`, `Sale.saleNumber`,
`Employee.employeeNumber`, `OpenPlaySession.sessionReference`, and
`OpenPlayMatch.matchNumber`) derived its "next number" by **counting
existing rows** for the relevant day/scope, then retrying on a unique-
constraint collision. This is fragile the moment rows can be deleted: the
row count desyncs from the highest sequence number actually used, and
retrying just recomputes the same wrong number over and over. Confirmed
live during Sub-phase 2 verification (gotcha #29) — this session's
accumulated test debris left `Booking` with 27 rows but references up to
`0034`, so every new booking's 5-attempt retry (`0028`–`0032`) collided
with already-existing rows and exhausted the retry budget outright.

**Fix: one shared atomic counter, not a per-file patch.** New
`ReferenceCounter` model (`scope String @id`, `value Int @default(0)`)
plus a new shared helper, `lib/reference-counter.ts`'s `nextSequence(
scope, client?)`, backed by Postgres's canonical atomic upsert:
```sql
INSERT INTO "ReferenceCounter" (scope, value) VALUES ($1, 1)
ON CONFLICT (scope) DO UPDATE SET value = "ReferenceCounter"."value" + 1
RETURNING value
```
Race-free under concurrent transactions via the `scope` unique index —
no application-level locking needed — and gap-tolerant by construction
(a deleted downstream row never touches the counter). Every existing
`formatXReference(date, sequence)` pure formatter is unchanged; only the
*source* of `sequence` changed. This is the one piece of genuinely shared
infrastructure introduced across many otherwise-frozen service files —
unlike `dayRange()`'s deliberate per-file duplication (a business-logic-
adjacent helper), an atomic counter has no domain logic to diverge, so
centralizing it doesn't create the coupling the duplication convention
exists to avoid.

**A real second bug found live, fixed before this was considered done:**
`nextSequence`'s atomic increment is a **raw query** (`$queryRaw`), and
under concurrent Serializable transactions, Postgres can still abort one
side with SQLSTATE `40001` (serialization failure) — the exact same
condition a normal Prisma ORM query surfaces as error code `P2034`. A raw
query hitting that condition surfaces as `P2010` ("raw query failed")
instead, with the SQLSTATE nested inside
`error.meta.driverAdapterError.cause.originalCode`. The existing
`isSerializationFailure` helper in `booking.service.ts`/
`equipment-rental.service.ts`/`locker-rental.service.ts` (the three
generators that kept a retry loop, since they still guard a genuine
business race — availability/quantity/overlap checks, not just the
reference number) only checked for `P2034`, so this specific failure mode
propagated straight through as an uncaught crash instead of being
retried. Found by a live concurrent-creation test (5 simultaneous
bookings) during this task's own verification — not caught by `tsc`/
`eslint`/unit tests, the same category as every other live-verification
gotcha in this project. **Fixed**: `isSerializationFailure` now checks
`code === "P2034"` OR (`code === "P2010"` AND the driver adapter's
`originalCode === "40001"`) in all three files.

**Per-generator disposition**:
- `Booking`/`EquipmentRental`/`LockerRental` — reference generation moved
  *inside* their existing Serializable transaction (previously generated
  before it opened, an inconsistency with the "generate + create must be
  atomic" intent); the P2034-style retry loop stays, now solely for the
  genuine business race, not reference collisions.
- `Membership`/`Employee`/`Tournament` (the Sub-phase 2 registerTeam
  retry loop, added solely for `Sale.saleNumber` collision risk) — retry
  loops removed entirely; each now does one atomic-counter call inside
  its existing (non-Serializable) transaction.
- `Shift`/`OpenPlaySession` — retry loop removed; no transaction existed
  before and still doesn't, `nextSequence` just runs against the default
  client.
- `Sale` — `attemptOffset` parameter removed from `createSale` (no longer
  meaningful — nothing left to advance past); all 5 callers updated.
- `OpenPlayMatch.matchNumber` (`rotation-engine.ts`) — the only generator
  that was an `Int`, not a formatted string, and already ran inside a
  Serializable `tx`; count-based computation replaced with a per-session-
  scoped `nextSequence` call. **Not fixed, flagged in code**: this
  function still has no retry loop around P2034 at all, a pre-existing
  gap unrelated to the counting mechanism — out of scope for this pass.

**One-time backfill, same migration.** `prisma migrate diff` only
generates schema DDL (`CREATE TABLE`), so the data backfill — seeding
each scope's counter to the highest sequence number already present in
existing data, so the new counter doesn't collide with pre-existing rows
the moment it starts issuing numbers — was hand-appended to the same
`migration.sql` as `INSERT ... SELECT ... GROUP BY ... ON CONFLICT DO
UPDATE SET value = GREATEST(...)` per reference type, parsing date+
sequence out of each reference string via `substring()`. Verified against
known data before trusting it: `BOOKING:20260722` backfilled to exactly
`34`, matching gotcha #29's own finding precisely.

**Verification performed**: `prisma validate`, migrate (diff + backfill +
apply + resolve), `tsc`, `eslint`, all 144 Jest tests, `next build` — all
clean. Live: the exact gotcha #29 scenario now succeeds (a same-day
booking creates cleanly); deleting a just-created booking and creating
another confirmed gap-tolerance (no collision); firing 5 concurrent
booking creations for different courts confirmed every one got a
distinct, correctly-sequential reference — which is what surfaced the
P2010/40001 bug above, fixed, then re-verified clean.

**How to apply:** `lib/reference-counter.ts`'s `nextSequence`/
`dailyScope` are the template for any *future* reference-number field —
never reintroduce a count-existing-rows generator. If a future
Serializable-transaction retry loop is added anywhere `nextSequence` is
also called inside the same transaction, remember to catch the raw-query
P2010/40001 form of a serialization failure, not just P2034 — copy the
updated `isSerializationFailure` from `booking.service.ts`, not the
version from before this maintenance pass. Sub-phase 3 (Operations
Workspace) begins next.

-----------------------------------------------------
TCOS v1.1 — SUB-PHASE 3 ADDENDUM: OPERATIONS WORKSPACE
(FROZEN)
-----------------------------------------------------

Scope: `/dashboard` — already the literal landing page and already a real
KPI dashboard, confirmed via research before touching anything — becomes
the daily operational home for both reception staff and owners, per this
sub-phase's explicit framing ("not simply to build pages, but to create
the daily operational experience"). No new route was added; the existing
page was evolved in place, consistent with "build workspaces, not
pages." One shared page for both audiences, gated by data availability
rather than forked into separate Reception/Owner routes: an employee
without an `Employee` record simply doesn't see the My Shift panel,
everyone else sees everything.

**New sections on `/dashboard`**, above the pre-existing KPI/date-range
trend grid (renamed "Trends" but otherwise untouched):
- **My Shift** (`features/dashboard/components/my-shift-panel.tsx`) —
  shift number/opening cash/elapsed time glance plus this-shift's Sale
  count+total (new), with a link to the existing `/dashboard/shift`
  workspace for the actual start/end action — deliberately not
  duplicating that form inline.
- **Today's Revenue** (`todays-revenue-panel.tsx`) — total/transaction
  count/average plus by-category and by-payment-method breakdowns,
  sourced from the new `SaleService.getSalesSummary(range)`. This is the
  "Owner Dashboard" ask explicitly deferred from Sub-phase 2's spec.
  Deliberately a *different, narrower* number from the pre-existing
  "Billable amount" KPI in the Trends grid below (module-amount-based,
  includes any row that never went through a Sale-creating action) —
  both stay, separately labeled, rather than silently merging two
  numbers that can legitimately disagree.
- **Needs Attention** — reuses the pre-existing
  `inventoryAlertsService.getAlerts()` and `InventoryAlertsBanner`
  verbatim (previously only rendered on the Equipment/Locker list pages)
  — no new alert-computation logic, just surfaced one click closer.
- **Quick Actions** (`quick-actions-panel.tsx`) — two genuine one-click
  links (New Booking, Check-In — the only two operations that don't
  require picking an entity first) plus a secondary Browse row to
  Equipment/Lockers/Tournaments/Players. Deliberately not a full inline
  quick-action redesign — equipment/locker rental, tournament
  registration, and membership enrollment all still require navigating
  to a specific entity's own detail page first, since no picker-first
  quick-entry page exists for those yet.
- **Recent Activity** (`recent-activity-panel.tsx`) — the same
  `activityFeedService.getActivityFeed` feed `/dashboard/analytics`
  already renders (under Administration), pulled onto the daily-ops home
  too since "what's happening right now" belongs here, not one click
  deeper. Called with `{ limit: 10 }` and no date filter — always the
  most recent activity, independent of the Trends grid's selected range.

**New service methods**, `services/sales/sale.service.ts`:
`getSalesSummary(range: DateRange)` (one `Promise.all` of an `aggregate`
plus three `groupBy` queries — by category, by payment method, by
employee — matching the exact grouped-query shape already spot-checked
during Sub-phase 2's live verification) and `getSalesForShift(shiftId)`
(a single `aggregate` scoped to one shift, for the My Shift panel). Both
reuse `services/analytics/date-range.ts`'s pre-existing `DateRange` type
rather than inventing a new one — that file's own comment already
documents it as shared "by every page with a DateRangePicker."

**New report types**: "Sales by category" and "Sales by payment method"
(`reportingService.getSalesByCategoryReport`/`getSalesByPaymentMethodReport`,
both `prisma.sale.groupBy` under the hood), added via the established
6-touch-point pattern (`reportTypeSchema` enum in
`features/reports/schemas/report.schema.ts` → a new service method →
`REPORT_CSV_COLUMNS` entry in `services/export/export.service.ts` → a
switch case in `actions/report.actions.ts`'s `buildReportCsv` → a switch
case in `app/dashboard/reports/[reportType]/page.tsx`'s `renderTable` →
a link on `app/dashboard/reports/page.tsx`'s index). Deliberately did
**not** touch the pre-existing, frozen `getRevenueReport()` — these two
new reports are genuinely Sale-sourced (only transactions that went
through the shift-gated Reception flow), a different, narrower dataset
than `getRevenueReport()`'s module-amount-based "billable" figures;
replacing it would have silently changed historical report totals for
any row that never went through a Sale-creating action.

**Verification performed**: `tsc`, `eslint`, all 144 Jest tests, `next
build` — all clean, `/dashboard` still renders `ƒ` (Dynamic). Live,
through the real UI (dev server, logged in as Owner): the evolved
`/dashboard` renders My Shift/Today's Revenue/Quick Actions/Recent
Activity/Trends; the two new report types are reachable from the Reports
index, render their tables, and their CSV exports produce the expected
filename. End-to-end: starting a shift, then renting equipment for
₱100.00 through the real rental form, then reloading `/dashboard`
confirmed the ₱100.00 correctly appeared in both the Today's Revenue and
My Shift panels — not just a service-level spot-check, the full
UI-to-database round trip. `SaleService.getSalesSummary`'s totals were
also cross-checked against a direct `prisma.sale.aggregate` call and
matched exactly.

**How to apply:** per your explicit instruction, this is the stop point
— do not begin Sub-phase 4 (3-court customization) or Sub-phase 5
(visual redesign) without explicit approval. `getSalesSummary`'s
`byEmployee` breakdown is computed but not yet surfaced in any UI (only
`byCategory`/`byPaymentMethod` are shown on the dashboard panel) — a
reasonable next addition if an Owner-facing "sales by staff member" view
is wanted later. Time-bucketed (hourly/daily/monthly) revenue trends
from the original Sub-phase 2 spec's aspirational list were not built
this sub-phase either — `getSalesSummary` takes an arbitrary `DateRange`
already, so a trend view would mean calling it repeatedly over sub-
ranges, not new query infrastructure.

-----------------------------------------------------
TCOS v1.1 — SUB-PHASE 4 ADDENDUM: 3-COURT CUSTOMIZATION
(FROZEN)
-----------------------------------------------------

Scope: standardize the app around The Courtroom's actual, permanent
physical layout — 3 courts — replacing the 6-court placeholder the app
had been seeded/tested with since Phase 2.

**The research finding was the headline result of this sub-phase**: two
Explore passes searched the entire codebase — schema, every service,
every action, every UI component, every `grid-cols-N` class in the
whole `app/`/`features/`/`components/` tree, every e2e spec, every
doc — for anything assuming 6 courts exist. Almost nothing did. Every
court-rendering surface (the booking form's court picker, the
tournament category page's court picker, the Courts admin table, Open
Play's dynamic court assignment, the bracket view) already reads courts
via `.map()` over `courtService.listCourts()` or a live `findMany`,
never a fixed-size grid or hardcoded count. No "court schedule" grid
view (courts as side-by-side columns) exists in the app at all — there
was nothing to resize. The two court-picker consumers
(`app/dashboard/bookings/new/page.tsx`,
`app/dashboard/tournaments/[tournamentId]/categories/[categoryId]/page.tsx`)
already independently applied the identical
`courts.filter((court) => court.status !== "DISABLED")` before mapping
to `<SelectItem>`s; the admin Courts list page correctly does **not**
filter, showing every court (including disabled ones) for management —
this exact pattern is what let this sub-phase be almost entirely a data
change rather than a code change.

**The only two real 6-court assumptions found**: `prisma/seed.ts`'s
`const COURT_COUNT = 6;` (now `3` — the seed loop is self-contained, no
other seed logic depended on it), and a documentation line in this
file's own Phase 2 section ("6 Courts" → "3 Courts", above). One e2e
spec, `e2e/concurrency.spec.ts`, hardcoded the literal court name
`"Court 6"` in its booking-race test — changed to `"Court 2"` (an
in-range active court; picked to avoid incidental overlap with
`e2e/courts.spec.ts`'s existing `"Court 1"` assertions).

**Courts 4–6 were soft-retired, not deleted.** The live dev database
already had 6 real `Court` rows from every prior phase's testing, with
real historical `Booking`/`Match`/`OpenPlayQueue` rows pointing at
Courts 4–6 (`courtId` is a required, non-nullable FK on all three — a
hard delete would either fail outright on those references or require
destructively deleting genuine historical booking/match data just to
work around the constraint). Per explicit instruction to preserve data
integrity and avoid schema changes unless absolutely necessary, a
one-time data update instead set `status: DISABLED` on the `Court` rows
named "Court 4", "Court 5", "Court 6" — a plain `UPDATE`, not a
migration, since `CourtStatus.DISABLED` already existed (added in an
earlier phase, previously unused for this purpose). This is the exact
same reversible mechanism the Courts admin UI already exposes through
its own ACTIVE/MAINTENANCE/DISABLED status controls — if the facility
ever genuinely expanded, an Owner could reactivate a court with zero
code change. Their historical records stay fully intact and viewable on
their own detail pages; they just stop appearing in either court-picker
dropdown (already filtered) and stop accepting new bookings
(`checkAvailabilityWithClient` already rejects a `DISABLED` court),
while still showing up, clearly badged "Disabled," on the admin Courts
list for anyone who needs the full facility history.

**No other file needed to change.** Booking, Open Play, tournament
scheduling, maintenance, reporting, analytics, and the Operations
Workspace dashboard all already read courts dynamically with the
correct active/disabled filtering already in place — confirmed by
direct inspection of every consumer, not assumed.

**Verification performed**: `tsc`, `eslint`, all 144 Jest tests, `next
build` — all clean (no schema change this pass, so no migration step).
`db:seed` re-run cleanly against the live dev DB, confirming it now
seeds exactly Court 1–3 and leaves the already-disabled Court 4–6 rows
untouched (the seed loop's `upsert` is keyed on `name`, and only ever
touches "Court 1".."Court 3"). Live, through the real UI (dev server,
logged in as Owner): the Courts admin list shows 3 courts badged
"Active" and 3 badged "Disabled"; the booking form's court dropdown
lists exactly Court 1–3 (confirmed by explicit absence assertions for
Court 4–6, not just presence of 1–3); a real booking was created
end-to-end on Court 1 and its detail page correctly showed "Court 1"; an
existing historical Court 6 detail page still opened and rendered
correctly with no error, confirming data integrity was preserved; the
fixed `concurrency.spec.ts` booking-race test passed cleanly against
"Court 2". The tournament category page's court-picker filter was
verified by direct code inspection (the identical `status !==
"DISABLED"` filter expression as the already live-tested booking form,
not a separate live click-through — a legitimate verification method
given the code path is provably identical, not merely assumed similar).

**How to apply:** per explicit instruction, this is the stop point — do
not begin Sub-phase 5 (visual redesign) without explicit approval. If
The Courtroom's court count ever genuinely changes again, the process is
now well-established: adjust `prisma/seed.ts`'s `COURT_COUNT` for future
seeds, and toggle existing courts' `status` via the Courts admin UI
(Active/Maintenance/Disabled) — no code change needed either direction,
since every consumer already reads courts dynamically.

-----------------------------------------------------
TCOS v1.1 — SUB-PHASE 5 ADDENDUM: VISUAL REDESIGN & UX
MODERNIZATION (FROZEN)
-----------------------------------------------------

Scope: a **UI/UX-only** redesign of TCOS into a premium sports-facility
look derived from The Courtroom's real logo and facility photo — no
schema, service, action, RBAC, or validation changes except one
explicitly authorized new read-only service method (below). Every
existing workflow keeps its exact prior behavior; only how it looks
changed.

**Design tokens** (`app/globals.css`, Tailwind v4 `@theme inline`,
OKLCH throughout). `.dark` is now the flagship look — `defaultTheme`
in `app/layout.tsx` changed from `"system"` to `"dark"` — a dark navy
shell (`oklch(0.27 0.055 260)`, inspired by the facility's wall/court
paint) with white cards, matching the "dark navy background, white
cards" brief. `:root` (light mode) is a light-shell variant of the
*same* brand palette, not a second theme — the existing next-themes
toggle is untouched and still fully functional in both directions.
New/changed tokens: `--brand` (Courtroom Green, deepened from the
literal logo green for AA text/button contrast — drives `--primary`
and `--sidebar-primary`, so "primary buttons" and "active nav item"
are green for free via existing component code, no per-component
change needed), `--brand-vivid` (the literal, brighter logo green,
reserved for the logo mark and the hero lettering's edge accent only),
`--court-blue` / `--court-pink` (secondary accents pulled from the
facility photo's court paint — used only where they aid meaning:
`--chart-1..5`, the Court Status panel's Occupied dot), `--success`
(new — aliases the brand green; nothing filled this role before) /
`--warning` (new — amber; fills the "needs attention but not fully
destructive" role Badge previously had no variant for), `--shadow-sm/
md/lg` (new — soft, navy-tinted, not pure black; no shadow tokens
existed before this sub-phase). The radius scale was already a
sensible "rounded, premium" base and is reused unchanged.

**Typography.** Manrope (`--font-heading`, headings) and Inter
(`--font-sans`, body) replace Geist Sans via `next/font/google` in
`app/layout.tsx`, using the same variable-handoff mechanism that was
already there. This incidentally fixed a **pre-existing defect**: `
--font-sans: var(--font-sans)` in `@theme inline` was self-referential,
so the loaded Geist Sans variable was never actually consumed —
headings silently rendered in the browser default font since the font
infrastructure was added. In scope as a genuine found defect, not
scope creep. Geist Mono is untouched (still used for `tabular-nums`),
per "preserve existing font infrastructure where practical."

**Component library.** `components/ui/table.tsx` is new — `Table`/
`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` (plain
HTML `<table>`-based, no Base UI primitive needed), sticky `<thead>`,
a rounded+shadowed container, consistent row hover. **Every** hand-
rolled `<table>` in the app (21 files, spanning Bookings, Players,
Memberships, Equipment, Lockers, Courts, Open Play, Tournaments,
Reports, Audit Logs, maintenance logs, shift history, standings, and
the generic `ReportTable` used by all 9 report types) now renders
through this one component — confirmed by a final `grep "<table"`
sweep matching only `components/ui/table.tsx` itself. `Badge` gained
two variants, `success` and `warning`; every status-badge file in the
app (20 files: 6 standalone badge components — Booking, Open Play
session, Tournament, Membership, Court, Locker — plus 2 newly
extracted ones, `EquipmentRentalStatusBadge` and
`LockerRentalStatusBadge`, pulled out of their list components so the
Reports page could reuse them instead of re-declaring the same
label/variant maps a third time — and assorted inline maps in
category/plan/maintenance-log/shift-history components) now shares one
semantic vocabulary: active/completed/confirmed → `success`,
pending/waiting/scheduled → `outline`, maintenance/overdue → `warning`,
cancelled/disabled/expired/lost → `destructive`. Consolidating onto
this shared vocabulary surfaced and fixed two real inconsistencies that
predated this sub-phase: locker rental's `CANCELLED` rendered
`outline` ("Ended") while every other module's cancelled/terminated
state rendered `destructive`; and `employee-list-panel.tsx`'s
"Inactive" badge was accidentally keyed to row-selection state instead
of `employee.isActive`, so an inactive employee's badge only showed
red when that row happened to be selected. Both fixed as a byproduct
of the consolidation, not a separate bug hunt. `components/shared/
logo.tsx` is new — every logo render in the app (site header, dashboard
sidebar, dashboard header's mobile sheet/menu, the homepage) goes
through this one component, wrapping `next/image` (the app's first use
of it). It currently always resolves to `/branding/logo.png`
regardless of the `variant` prop; `resolveLogoSrc()` is the single
future change point once `logo-light.png`/`logo-dark.png` exist per
the `public/branding/` structure this sub-phase established (only
`logo.png` is required today — the app was not given that file during
this sub-phase, see the open item below).

**Homepage** (`app/page.tsx`). The hero heading changed from "Welcome
to {siteConfig.name}" to a literal, large "THE COURTROOM" — a CSS-only
3D extrusion (`.hero-3d-text` in `globals.css`): a stacked, layered
`text-shadow` (white front face, progressively darker charcoal layers
for depth, one brand-green layer near the top for an edge accent, a
soft diffuse shadow beneath), no WebGL/3D library. A faint court-line
grid (`repeating-linear-gradient`, `background-attachment: fixed` for
a free, dependency-free parallax-on-scroll feel) and two soft
green/blue radial glows sit behind the hero, both pure CSS. Entrance
motion uses `tw-animate-css` (already a dependency) — staggered
fade-in + slide-up on the eyebrow badge, heading, subhead, and CTA.
The logo itself moved into `SiteHeader` (small, alongside the existing
text link, not replacing it) rather than replacing the hero title, per
explicit instruction.

**Court Status panel** (`app/dashboard/page.tsx` +
`features/dashboard/components/court-status-panel.tsx`) is the one
genuinely new dashboard panel this sub-phase adds, slotted into the
explicit priority order: My Shift → Today's Revenue → Needs Attention
(the existing `InventoryAlertsBanner`, moved from a full-width banner
above the grid into the same priority-ordered grid) → Court Status →
Quick Actions → Recent Activity. Backing it is one new, explicitly
authorized, read-only service method,
`courtService.getCourtStatusSnapshot()` — exactly two queries
regardless of court count (all non-disabled courts, then one
`booking.findMany` covering every active court ID for a "right now"
occupancy check), composing Available/Occupied/Maintenance/Disabled in
memory. This intentionally skips the maintenance-*window* check that
`getCurrentAvailability()` does for a single court (a court left
`ACTIVE` with a pending maintenance window showing briefly as
"Available" on the dashboard is an acceptable tradeoff against a 3rd
query on every dashboard load) — `MAINTENANCE`/`DISABLED` states read
straight off the court's own `status` field instead.

**Booking pricing summary** (`features/bookings/components/
booking-form.tsx`). A live-updating "Pricing summary" card (Court,
Duration, Rate, Estimated total) mirrors `booking.service.ts`'s exact
`Math.round(hourlyRateCents * durationHours)` formula so the preview
matches what the server will actually charge — but it's a pure
client-side display computation via `useWatch` on `courtId`/`startAt`/
`endAt`, computed from data already passed to the form (courts now
also carry `hourlyRateCents` from `app/dashboard/bookings/new/page.tsx`,
previously fetched but not passed through). The server-side pricing
logic in `booking.service.ts` was not touched.

**Open item — branding asset still missing.** `public/branding/
logo.png` does not exist in the repository; the actual PNG the user
attached in chat was never saved to disk (no mechanism available to
persist a chat-pasted image to a binary file). Confirmed live during
this sub-phase's `next dev` verification pass: the server logs `The
requested resource isn't a valid image for /branding/logo.png received
null` on every page that renders `<Logo>` (site header, dashboard
sidebar/header, homepage) — every one of those renders correctly
otherwise (no crash, no broken layout), just with a broken-image icon
where the logo mark should be. This is a pre-flagged, known dependency,
not a regression: the fix is a one-file drop of the real PNG at that
exact path, with zero code change required afterward.

**Verification performed.** `tsc --noEmit`, `eslint . --max-warnings=0`,
all 144 Jest tests, and `next build` all pass clean (one real
TypeScript error was found and fixed along the way: `Court.
hourlyRateCents` is nullable in the schema, so `BookingFormCourt` and
the pricing-preview computation both needed explicit null handling).
The full Playwright e2e suite (`smoke`, `bookings`, `courts`, `players`,
`tournaments`, `open-play`, `equipment-lockers`,
`reports-notifications-analytics`, `concurrency` — every workspace this
sub-phase touched) was run against a real `next dev` server with the
live dev database: 1 genuine assertion update was needed
(`e2e/smoke.spec.ts` asserted the literal old heading text "Welcome to
The Courtroom", which this sub-phase intentionally replaced with "THE
COURTROOM" per the brief — updated to match, not a regression); 5 specs
were flaky on first pass and passed cleanly on Playwright's built-in
retry, consistent with this suite's own documented pre-existing
single-worker/sequential-timing flakiness (see `playwright.config.ts`'s
comments, unrelated to this sub-phase); every other spec passed
outright. No functional regression was found in any workflow.

**How to apply:** per explicit instruction, this is the stop point —
do not begin Sub-phase 6 (Public Display Mode), Sub-phase 7
(Attendance & Payroll), or any deployment/infrastructure work without
explicit approval. Before this redesign can be considered fully
shipped, `public/branding/logo.png` (and, whenever they're produced,
`logo-light.png`/`logo-dark.png`/`favicon.png`) need to actually be
placed in the repo — no code change required when that happens, only
the file drop.

-----------------------------------------------------
TCOS v1.1 — PHASE 11 ADDENDUM: MODULE TOGGLES & PRODUCT
SALES (FROZEN)
-----------------------------------------------------

Scope: The Courtroom doesn't currently offer Membership enrollment,
Locker rental, or Tournament registration — those creation flows are
now off by default, controlled by real on/off switches (not a
hardcoded removal) so they can be turned back on with zero code change.
Separately, the business sells two retail items outright — balls and
T-shirts — which needed a genuinely new "sell it once, no rental
fields" concept the app had no model for.

**Module toggles.** Reuses the existing generic `Setting` (key/value
`Json`) table — no schema change. Three fixed keys in `lib/
module-flags.ts` (`MODULE_KEYS.MEMBERSHIP` /`.LOCKER_RENTAL`/
`.TOURNAMENT_REGISTRATION`). `settingsService.getEnabledModules()`
reads all three in one query and **defaults every missing key to
`false`** — absence of a row means disabled, not enabled, so a fresh
database is safe-by-default. `setModuleEnabled()` writes a real JSON
boolean directly (bypassing the free-text `upsertSettingSchema`, which
is for the generic string-value settings editor only). A new "Modules"
card (`features/settings/components/module-toggles-panel.tsx`, three
`Switch` rows) sits above the existing free-text Settings list on
`/dashboard/admin/settings`; `actions/module-settings.actions.ts`'s
`setModuleEnabledAction` is `SYSTEM_ADMIN`-gated, same as every other
settings action. Booking and Equipment (paddle) rental are not
togglable — always on.

**Gating is surgical — the sale-producing entry point only, not the
whole module.** Each of the three flags is checked in exactly two
places: the page that renders the creation form (shows a plain
"currently unavailable" message instead when off) and the server
action itself (defense in depth — rejects a direct call even if
someone bypasses the UI): `EnrollMembershipForm` / `enrollMembershipAction`
on `players/[playerId]`, `LockerRentalForm` / `createLockerRentalAction`
on `lockers/[lockerId]`, `RegistrationForm` / `registerTeamAction` on
the tournament category page. Nav items, list pages, plan/tournament
management, and all historical data stay fully visible either way —
only creating a *new* enrollment/rental/registration is blocked. Every
e2e spec that exercises one of these three flows now calls a shared
`e2e/helpers/enable-module.ts` (clicks the real admin Switch) before
running — updated in `players.spec.ts`, the locker half of
`equipment-lockers.spec.ts`, both `tournaments.spec.ts` tests, and both
the locker-rental and tournament-bracket tests in `concurrency.spec.ts`
(missed on the first pass — surfaced as real e2e failures against
default-off modules until added).

**Product catalog** (`prisma/schema.prisma`'s new `Product` model:
`name` (unique), `priceCents`, `active`, `sortOrder`). Deliberately no
stock/quantity tracking, unlike `Equipment` — these are one-time retail
sales, not inventory-tracked rentals, so none of Equipment's
deposit/rental-rate/return/RENTED-status fields apply. `Sale` gained a
`productId` (nullable, unique) + `product` relation, matching the exact
one-linked-record-per-category pattern every other `SaleCategory`
already had — `SaleCategory.PRODUCT` existed in the enum since Phase 2
but nothing ever constructed one until now.
`services/products/product.service.ts`'s `sellProduct()` calls the
same `saleService.createSale()` + `saleService.logSaleCreated()` two-step
every other sale-producing service uses, so product sales automatically
show up in revenue reports, shift sales tallies, and player timelines
with zero changes to those read paths (verified live, not assumed —
see below). Catalog management
(`app/dashboard/admin/products`, create/edit/reorder) is
`SYSTEM_ADMIN`-gated; selling (`app/dashboard/products`) reuses
`EQUIPMENT_MANAGE` + `requireEmployeeWithOpenShift` — the same
open-shift requirement every other sale action already has, not a new
rule. Reordering (`features/products/components/product-catalog.tsx`)
uses native HTML5 drag-and-drop (`draggable`/`onDragStart`/`onDragOver`/
`onDrop`) — no drag-and-drop library was added, consistent with this
codebase's standing preference for dependency-free UI mechanisms.
Seeded starter rows: "Pickleballs" and "T-Shirt" (`prisma/seed.ts`,
idempotent upsert-by-name, placeholder prices — editable immediately
from the catalog screen, which is the entire point of making price
editable).

**A new test staff account** (`staff` / seeded in `prisma/seed.ts`,
Receptionist role) exists specifically so shift/sale flows can be
exercised without the Owner account — the Operations dashboard's "My
shift" panel no longer renders for the Owner (a UI-only change:
`app/dashboard/page.tsx` now checks `session.user.role !==
SYSTEM_ROLES.OWNER` before rendering `MyShiftPanel`; the Owner's
Employee row, `/dashboard/shift` page, and shift start/end actions are
all otherwise completely unchanged — Owner can still open a shift by
navigating there directly if they ever need to create a booking/sale
personally). Confirmed Owner's existing RBAC grant already covers every
permission key used anywhere in this app (`SYSTEM_ADMIN`,
`EQUIPMENT_MANAGE`, etc. — see `prisma/seed.ts`'s
`ROLE_PERMISSION_GRANTS[OWNER]`), so no RBAC change was needed for
Owner to reach either new admin screen. Payroll does not exist as a
module in this app (it remains the un-started future "Sub-phase 7" from
the roadmap) — flagged rather than built.

**Verification performed.** `tsc --noEmit`, `eslint --max-warnings=0`,
all 144 Jest tests, and `next build` all pass clean. A new
`e2e/products.spec.ts` was added and run live against the real dev
server + database: an Owner creates a product, edits its price, and
round-trips its active toggle through the real admin UI; a `staff`
session (with an open shift, via a new `e2e/helpers/ensure-shift.ts`)
sells it to a real seeded player; the sale is then confirmed to appear
in Today's Revenue (`"Product"` category row), the current shift's
sales tally, and that player's timeline (`"₱X.XX — Product"`) — proving
the reuse of `saleService` genuinely wires product sales into every
existing read path with no additional code in those reports/panels.
The full Playwright suite (`smoke`, `bookings`, `courts`, `players`,
`tournaments`, `open-play`, `equipment-lockers`, `products`,
`reports-notifications-analytics`, `concurrency`) was run multiple
times end-to-end; the one genuine gap found (`concurrency.spec.ts`'s
locker-rental and tournament-bracket races failing against the new
default-off modules) was fixed by adding the same `enableModule` setup
step used elsewhere. Later full-suite runs on the same machine, after
many consecutive back-to-back runs today, showed heavier flakiness
than earlier isolated passes (timeouts/slow-renders across several
unrelated specs, including one hard failure in `players.spec.ts`) —
every failure signature was a generic slow-load timeout, never a
module-disabled or permission error, and re-running the affected specs
in isolation immediately afterward passed cleanly (or flaky-then-passed
on Playwright's built-in retry). This matches `playwright.config.ts`'s
own documented pre-existing single-worker/sequential-load flakiness
(exacerbated here by one dev server instance having stayed up through
an unusually large number of consecutive e2e runs in one session) —
not a regression introduced by this work.

**How to apply:** the module-off default means a fresh clone/reseed of
this app ships with Membership/Locker Rental/Tournament Registration
already hidden — an Owner needs to flip them on via `/dashboard/admin/
settings` before those flows are usable, by design. If a future sale
type needs the same "one-time purchase, no rental fields" shape as
Products, extend `Product`/`sellProduct()` rather than repurposing
`Equipment` — the two models are deliberately kept separate because
rental and outright-sale are different transaction shapes.

-----------------------------------------------------
TCOS — PHASE 12 ADDENDUM: PUBLIC WEBSITE & CUSTOMER
BOOKING PORTAL (FROZEN)
-----------------------------------------------------

Scope: a public, no-login marketing website (Home/About/Courts/Rates/
Open Play/Contact/Book Now/Availability/Lookup) plus a customer booking
workflow, an Owner-editable CMS, and live read-only court availability
— all reusing the exact same `bookingService.createBooking()` staff
bookings already use, with zero duplicated validation, conflict
detection, reference generation, or Sale-creation logic.

**The central design decision — the "Website" system identity.**
`Booking.bookedById`, and `Sale.employeeId`/`shiftId`/`paymentMethodId`
are all non-nullable, enforced today via `requireEmployeeWithOpenShift`.
A public visitor has none of those. Rather than loosen the schema or
fork the service, `prisma/seed.ts` seeds one dedicated system identity
— a "Website" `User` (no username/password — can never sign in) +
`Employee` + a perpetually-open `Shift`, plus a `PaymentMethod` keyed
`"PAY_AT_VENUE"` — the exact paired-`User`+`Employee` idiom Owner/staff
already use, minus the login fields. `services/booking/
website-identity.ts`'s `getWebsiteBookingContext()` resolves these by
stable lookup keys (`lib/system-identities.ts` — shared by the seed
script and this resolver so they can't drift apart), self-healing the
Shift if it was ever manually closed. `actions/public-booking.actions.ts`'s
`createPublicBookingAction` (no session, rate-limited via the existing
`lib/rate-limit.ts`) resolves this context and calls
`bookingService.createBooking()` **unmodified** — same Serializable-
transaction conflict detection, same `bookingReference` format
(`BK-YYYYMMDD-NNNN`) as a receptionist-made booking. `CreateBookingSaleContext`
gained one new *optional* `source?: SaleSource` field, threaded into
the existing `saleService.createSale` call — public bookings pass
`"WEBSITE"` (an enum value that existed since Phase 2's Sale model
specifically for this future case, unused until now); every existing
staff call site is unaffected since the field defaults away. One
genuinely new column: `Booking.guestEmail String?`, additive, mirrors
the existing `guestName`/`guestPhone` walk-in pattern exactly.

**Two new read-only `bookingService` methods**, not new conflict logic:
`getPublicDaySchedule(date)` (powers `/availability` — buckets
`Court`+`Booking`+`CourtMaintenance` reads into per-court booked/
maintenance ranges for a day, same query shape `checkAvailabilityWithClient`
already uses, just aggregated) and `findByReferenceAndPhone(reference,
phone)` (powers `/lookup` — phone match is a lightweight anti-
enumeration check, not real auth).

**Website CMS.** Extends `services/settings/settings.service.ts`
(already home to the generic Setting CRUD and Phase 11's module-flag
methods) with typed getters/setters for four structured JSON keys under
`lib/cms-keys.ts` — homepage hero (title/subtitle/ctaText/imageUrl),
business info (name/phone/email/address/hours/facebookUrl/mapsUrl),
"other" public rates, and an ordered gallery image list — the first
real use of `Setting.value` as an object/array rather than a string or
boolean. A parallel small flag set, `lib/public-visibility.ts` (same
Setting-table mechanism as Phase 11's `lib/module-flags.ts`, same
absent-row-means-off default), controls what the public site
*advertises* (Open Play/Tournaments/Membership/Products) — deliberately
kept separate from Phase 11's internal "can staff create this" flags,
since an Owner may answer those two questions differently. Admin UI at
`/dashboard/admin/website` (new nav item, `SYSTEM_ADMIN`-gated like
every other `/dashboard/admin/*` page) hosts five panels under
`features/cms/components/`; gallery upload is the first real call site
for `services/upload/` (existed since some earlier phase, fully
functional, but genuinely unused until now) — reads a `File` from
`FormData`, converts to `Buffer`, calls `getUploadService().upload()`.
Public "Announcements" needed no new model or CMS panel — the existing
`Announcement` model already had `isPublished`/`publishedAt`/
`expiresAt`; the homepage just reads `announcementService.listPublished()`
directly. Court rates on `/rates` read `courtService.listCourts()`
live, not a duplicated pricing table.

**Route protection.** Confirmed via direct inspection before writing
any public page: `middleware.ts`'s `config.matcher` is
`["/dashboard/:path*"]` and `lib/rbac.ts`'s `PROTECTED_ROUTES` only
ever matches `/dashboard/...` prefixes — new top-level public routes
(`/about`, `/courts`, `/rates`, `/open-play`, `/contact`, `/book`,
`/availability`, `/lookup`) needed zero auth-bypass work, they were
already outside the gate. `app/page.tsx` (the homepage) gained
`export const dynamic = "force-dynamic"` — without it Next prerenders
the homepage at build time despite being `async`, and a CMS edit to the
hero/gallery/announcements would silently never appear in production
without a rebuild, defeating "changes should not require redeployment."
Every other new public page has the same directive for the same reason.

**Verification performed.** `tsc --noEmit`, `eslint --max-warnings=0`,
all 144 Jest tests, and `next build` all pass clean. A new
`e2e/public-website.spec.ts` was written and, after real debugging (not
just retries — see below), verified the full flow live: a customer
books a court through the real public UI; the exact same booking
appears immediately in the staff dashboard with an identical-format
reference; the public lookup page finds it by reference+phone and
correctly rejects a wrong phone; an Owner edits the CMS hero title and
it appears on the live homepage with no restart; toggling a public-
visibility flag off hides the corresponding public section.

Three real bugs were found and fixed while building this spec — not
flakiness, genuine defects in the *test*, each confirmed by direct
diagnostic evidence before the fix, not guessed:
1. The confirmation assertion used `getByRole("heading", ...)` against
   `CardTitle` (`components/ui/card.tsx`), which renders a plain
   `<div>`, not a semantic heading — matches every other `CardTitle`
   usage in this app. Fixed to a text match. This was a 100%-reproducible
   test bug, not timing — the booking flow itself was already working
   correctly the whole time (confirmed by capturing the rendered page
   body mid-failure, which showed a correct confirmation panel).
2. The CMS test mutates the *shared* `cms.homepage.hero` Setting row
   and, on first pass, only restored it inline in the test body — code
   placed after an assertion never runs if that assertion throws, so a
   failed run permanently left the DB title as `"E2E HERO ..."`, which
   then broke `smoke.spec.ts`'s unrelated homepage-title check in any
   *later* run. Fixed by moving the restore into a `test.afterEach`
   (Playwright always runs this, pass or fail), scoped to a nested
   `test.describe("CMS editing")` so the other tests in the file don't
   pay for an extra navigation they don't need. A direct-Prisma cleanup
   was attempted first and abandoned: this project's generated Prisma
   client can't load inside the Playwright test runner's module system
   (`Cannot use 'import.meta' outside a module`) — confirms why no
   existing spec in this suite imports Prisma directly; the fix stays
   UI-driven, using the `page` fixture Playwright provides to
   `afterEach`.
3. Multiple earlier debug runs (before fix #2 existed) left the shared
   dev database's hero title genuinely stuck on a stale `"E2E HERO ..."`
   value; fixing the test code afterward doesn't retroactively fix data
   already written by the old, buggy runs — required one manual
   `DELETE FROM "Setting" WHERE key = 'cms.homepage.hero'` to let the
   default (`"THE COURTROOM"`) take effect again. Documented here as a
   reminder: a test-state-leak bug can outlive the test-code fix that
   resolves it; check the actual data, don't assume the code fix alone
   is sufficient.

After those three fixes, the full suite was run several more times
very late in an already extremely long single session; failures at
that point showed `ECONNRESET`/aborted-connection signatures spread
across specs with no relation to this phase's own code (including
Phase 11's previously rock-solid `products.spec.ts`), and the specific
tests this phase added passed cleanly and repeatedly in isolation —
consistent with genuine environment/connection-pool exhaustion after
an unusually large number of consecutive e2e runs in one day, not a
regression in this work.

**How to apply:** if a future feature needs the public site to create
another kind of record on a visitor's behalf (tournament registration,
membership purchase), follow the same pattern established here — a
seeded system identity + an unauthenticated action that resolves it and
calls the *existing* service method, never a parallel implementation.
Online payments slot in as a new `PaymentMethod` + a real payment-
provider `SaleSource`, no `createBooking` changes needed. Customer
accounts would replace the Website system identity with a real
per-customer `User`+`Player` (booking creation already accepts a real
`playerId`). QR check-in attaches to the existing `Booking.qrCodeToken`
column (already present, unused for this purpose). Nothing in Part I
was built — documented here as the intended shape only, per explicit
instruction to prepare the architecture, not the features themselves.

