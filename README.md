# The Courtroom Pickleball Management System (TCPMS)

Production-grade management system for The Courtroom indoor pickleball facility. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full, frozen architecture — tech stack, folder
structure, RBAC design, and module roadmap. This repo is currently **Phase 1: Foundation** only.

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop (for local PostgreSQL + Adminer)

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the environment template and adjust if needed (defaults already match `docker-compose.yml`):

   ```powershell
   Copy-Item .env.example .env
   ```

   Generate a fresh `AUTH_SECRET` for real use with:

   ```powershell
   npx auth secret
   ```

3. Start local PostgreSQL and Adminer:

   ```powershell
   docker compose up -d
   ```

   Adminer (DB inspector) is then available at http://localhost:8080 — System: `PostgreSQL`,
   Server: `postgres`, Username: `courtroom`, Password: `courtroom_dev_password`, Database:
   `tcpms_dev`.

4. Generate the Prisma client and seed the database (roles, permissions, and one Owner login):

   ```powershell
   npm run db:generate
   npm run db:seed
   ```

   The seed script prints the Owner login credentials to the console. **Phase 1 does not create
   migrations** — schema changes are applied with `prisma migrate dev` starting in a later phase.

5. Run the dev server:

   ```powershell
   npm run dev
   ```

   Visit http://localhost:3000, sign in at `/login` with the seeded Owner account, and you should
   land on `/dashboard`.

## Scripts

| Script                 | Purpose                                         |
| ----------------------- | ------------------------------------------------ |
| `npm run dev`           | Start the Next.js dev server                     |
| `npm run build`         | Production build                                 |
| `npm run start`         | Run the production build                         |
| `npm run lint`          | ESLint                                           |
| `npm run typecheck`     | `tsc --noEmit`                                   |
| `npm run format`        | Prettier — write                                 |
| `npm run format:check`  | Prettier — check only                            |
| `npm test`              | Jest unit tests                                  |
| `npm run test:e2e`      | Playwright end-to-end smoke tests                |
| `npm run db:generate`   | Regenerate the Prisma client                     |
| `npm run db:validate`   | Validate `prisma/schema.prisma`                  |
| `npm run db:seed`       | Seed roles, permissions, and the Owner account   |
| `npm run db:studio`     | Open Prisma Studio                               |

## Notes

- Payments, outgoing email, and file uploads use local/dev implementations behind service
  interfaces in `/services` — see `ARCHITECTURE.md` for the factory pattern used to swap in real
  providers later without touching call sites.
- Feature flags for future modules (`lib/feature-flags.ts`) are env-driven and default to `false`.
- RBAC is database-backed (`Role` / `Permission` / `RolePermission` tables), not a hardcoded enum —
  see the Phase 1 Architectural Addendum in `ARCHITECTURE.md`.
