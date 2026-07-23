# Administrator Guide

For staff operating TCPMS day-to-day: what each role can do, and how to use
the Employee, Roles, Shift, Audit Logs, Settings, Reports, Analytics,
Announcements, and Diagnostics workspaces.

## Roles & permissions

Roles are not hardcoded — use the **Roles workspace**
(`/dashboard/admin/roles`, Owner-only) to create new roles and choose
exactly which permissions each one grants, with no code change. The
seeded defaults:

| Role | Can do |
|---|---|
| **Owner** | Everything, including `users:manage` (Employee & Role management) and the admin diagnostics page. |
| **Manager** | Everything Owner has except `users:manage` — can't create employees or edit roles. |
| **Receptionist** | Bookings, Open Play, Players & Memberships, Equipment & Lockers — the front-desk-run modules. No Reports/Analytics, no Tournaments, no Employee/Role management. |
| **Tournament Staff** | Tournament management, plus baseline dashboard access. Not front-desk modules. (Internal role key stays `TOURNAMENT_DIRECTOR`.) |
| **Cafe Staff** | Dashboard access only for now — reserved for a future cafe/point-of-sale module. |
| **Member** | Dashboard access only — a Member account exists so a player can be represented as a `User` (e.g. to receive personal notifications), not to grant them staff access. Never mix this up with an Employee account — Employees are staff, Players/Members are customers, and the two are never the same account. |

Built-in roles (marked "Built-in" in the Roles workspace) can have their
label, description, and permission set edited freely, but can't be
deleted or have their internal key renamed — some code paths (e.g. new
player accounts always get the Member role) look a role up by that
stable key. Any new role you create has none of that restriction.

A permission or role change takes effect the next time the affected user
logs in (or their session token refreshes) — not instantly, since
permissions are embedded in the session token at sign-in, not re-checked
against the database on every request. See
[ARCHITECTURE.md](../ARCHITECTURE.md)'s Phase 1 addendum and the Phase 10
RBAC Audit appendix for the full route/action × permission mapping (the
v1.1 addendum documents what changed on top of it).

## Reports

`/dashboard/reports` — one page per report type: Bookings, Court
Utilization, Open Play, Tournaments, Memberships, Equipment Rentals, Locker
Rentals, Revenue. Every report is date-range scoped (Today / 7 days / 30
days / 90 days / custom — the same picker used on the main dashboard) and
exportable to CSV via the "Export CSV" button, which downloads exactly what
the table shows.

"Revenue" figures are **billable amounts**, not collected/reconciled
revenue — TCPMS has no payment processing integration, so there's no
concept of "paid" vs. "billed" at the data level. Treat revenue reports as
what was charged, not confirmed cash received.

## Analytics

`/dashboard/analytics` — trend charts and participation breakdowns: court
utilization over time, membership growth, player activity, Open Play and
tournament participation, equipment/locker usage. Same date-range picker as
Reports. The main `/dashboard` landing page shows a condensed KPI summary
of the same underlying data.

## Announcements

`/dashboard/announcements` — visible to every authenticated staff member
(read access is intentionally broad; only creating/publishing/unpublishing/
deleting requires the `system:admin` permission, held by Owner/Manager).

- **Draft vs. Published**: a new announcement starts as a draft and is not
  shown in anyone's notification center until explicitly published.
- **Expiration**: an optional expiry date — once past, the announcement
  stops appearing in the active list automatically (no manual cleanup
  needed).
- Publishing fans out a personal notification to every active user
  immediately — there's no scheduled/batched delivery.
- Deleting an announcement asks for confirmation first (a two-step confirm
  dialog) since it's not reversible.

## Notification Center

The bell icon in the top bar, available to every signed-in user. Shows
personal notifications only — booking/tournament/membership/equipment/
locker reminders relevant to that specific user, plus published
announcements. Reminders are generated lazily (the moment the center is
opened, not on a schedule) and deduplicated, so reopening the bell never
creates a duplicate reminder for the same underlying event.

## Employee Workspace

`/dashboard/admin/employees` (Owner-only) — sign in with an admin-issued
username and password, not email; there is no self-registration.
Everything about one employee lives on this one screen: pick them from the
list on the left, and the panel on the right holds their profile (name,
phone, email, photo URL), role, active/inactive toggle, a password-reset
form, and their login history — no separate pages to click through.
Disabling an employee blocks their *next* login attempt (an already-signed-in
session keeps working until it expires, same as any other permission
change). Employees are staff — never confuse an Employee account with a
Player/Member account; they're intentionally separate concepts everywhere
in the interface.

## Roles Workspace

`/dashboard/admin/roles` (Owner-only) — create a new role, name it, and
toggle exactly which permissions it grants; assign it to an employee from
the Employee Workspace. No code change or deploy needed. See "Roles &
permissions" above for the built-in roles and what can/can't be edited.

## Shift Workspace

`/dashboard/shift` — every employee's own screen for clocking in and out.
Start a shift with an opening cash amount; end it with a closing cash
count and notes. Only one shift can be open per employee at a time, but
there's no limit on how many shifts a day — clock out for a break and back
in later if that's how your day works. Shift numbers look like
`SHIFT-20260722-001`.

## Audit Logs Workspace

`/dashboard/admin/audit-logs` (Owner/Manager) — a filterable, chronological
record of every recorded action in the system (who did what, and when),
including employee logins/logouts, employee and role changes, and every
other module's existing activity trail. Same date-range picker as
Reports/Analytics.

## Settings Workspace

`/dashboard/admin/settings` (Owner/Manager) — a small generic key/value
editor for facility-wide configuration values as they come up. Empty by
default; add a setting with a key, value, and optional description.

## Admin Diagnostics

`/dashboard/admin/diagnostics` — requires the `system:admin` permission
(Owner/Manager by default). A single-page, read-only snapshot for
confirming a deployment is healthy:

- **Application** — status, uptime.
- **Database** — connectivity and a live round-trip time.
- **Providers** — which payment/email/upload provider implementation is
  currently configured (all `local`/`console` unless changed via env vars).
- **Operational** — total users, today's active bookings, count of
  unresolved inventory alerts (low-stock equipment, unresolved damage
  reports, overdue rentals).

This is the fastest way to confirm a fresh deployment is actually talking
to its database and configured the way you expect — check it right after
any deploy. It reads the same data `GET /api/health` exposes, plus a few
extra counts; see [DEPLOYMENT.md](./DEPLOYMENT.md) for the release
checklist this page is part of.

## Confirmation dialogs

A small number of destructive, hard-to-undo actions now ask for
confirmation before firing: deleting an announcement, marking a rented
equipment item as lost, cancelling or marking a booking as no-show,
cancelling an Open Play session, cancelling a tournament. Every other
action (creating records, checking in, returning rentals, resolving
maintenance logs) still fires immediately on click — only genuinely
destructive, previously-irreversible actions were changed.
