// Loaded first: unlike Next.js (which loads .env automatically for the dev
// server/build) or prisma.config.ts (which does this itself), a plain tsx
// script has no automatic .env loading, and lib/env.ts validates
// process.env directly.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { env } from "../lib/env";
import { EQUIPMENT_KEYS } from "../lib/equipment-keys";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { dailyScope, nextSequence } from "../lib/reference-counter";
import type { BillingPeriod, EquipmentType, SkillLevel } from "../lib/generated/prisma/enums";
import { PAY_AT_VENUE_PAYMENT_METHOD_KEY, WEBSITE_SYSTEM_USER_EMAIL } from "../lib/system-identities";
import { formatEmployeeNumber } from "../services/employee/employee-number";
import { formatShiftNumber } from "../services/shift/shift-number";
import { PERMISSIONS, type PermissionKey } from "../types/permissions";
import { SYSTEM_ROLES, type SystemRoleName } from "../types/roles";

interface RoleDefinition {
  label: string;
  description: string;
}

interface PermissionDefinition {
  label: string;
  description: string;
}

const ROLE_DEFINITIONS: Record<SystemRoleName, RoleDefinition> = {
  [SYSTEM_ROLES.OWNER]: {
    label: "Owner",
    description: "Full access to every module and setting.",
  },
  [SYSTEM_ROLES.MANAGER]: {
    label: "Manager",
    description: "Day-to-day facility management and reporting.",
  },
  [SYSTEM_ROLES.RECEPTIONIST]: {
    label: "Receptionist",
    description: "Front-desk check-in, walk-ins, and payments.",
  },
  [SYSTEM_ROLES.TOURNAMENT_DIRECTOR]: {
    label: "Tournament Staff",
    description: "Runs tournaments, brackets, and scoring.",
  },
  [SYSTEM_ROLES.CAFE_STAFF]: {
    label: "Cafe Staff",
    description: "Cafe operations — no dedicated module yet.",
  },
  [SYSTEM_ROLES.MEMBER]: {
    label: "Member",
    description: "A registered player of The Courtroom.",
  },
};

const PERMISSION_DEFINITIONS: Record<PermissionKey, PermissionDefinition> = {
  [PERMISSIONS.DASHBOARD_ACCESS]: {
    label: "Access Dashboard",
    description: "Can sign in and view the staff/member dashboard.",
  },
  [PERMISSIONS.SYSTEM_ADMIN]: {
    label: "System Administration",
    description: "Elevated access reserved for future admin-only modules.",
  },
  [PERMISSIONS.USERS_MANAGE]: {
    label: "Manage Users",
    description: "Reserved for future user management screens.",
  },
  [PERMISSIONS.COURTS_MANAGE]: {
    label: "Manage Courts",
    description: "Create, edit, disable courts, and schedule maintenance.",
  },
  [PERMISSIONS.BOOKINGS_MANAGE]: {
    label: "Manage Bookings",
    description: "Create, view, and manage court bookings, including walk-ins and check-in.",
  },
  [PERMISSIONS.BOOKINGS_PAY_AT_VENUE]: {
    label: "Accept Pay-at-Venue Bookings",
    description:
      "Create a staff booking without GCash prepayment, even when the public site requires it.",
  },
  [PERMISSIONS.OPEN_PLAY_MANAGE]: {
    label: "Manage Open Play",
    description: "Run Open Play sessions: registration, check-in, and live queue rotation.",
  },
  [PERMISSIONS.TOURNAMENTS_MANAGE]: {
    label: "Manage Tournaments",
    description: "Create tournaments, manage brackets, and record match scores.",
  },
  [PERMISSIONS.PLAYERS_MANAGE]: {
    label: "Manage Players & Memberships",
    description: "Create and edit player profiles, and manage membership plans and enrollments.",
  },
  [PERMISSIONS.EQUIPMENT_MANAGE]: {
    label: "Manage Equipment & Lockers",
    description: "Manage equipment inventory, rentals, lockers, and maintenance logs.",
  },
  [PERMISSIONS.REPORTS_MANAGE]: {
    label: "View Reports & Analytics",
    description: "View operational reports, export CSVs, and view analytics dashboards.",
  },
};

const ROLE_PERMISSION_GRANTS: Record<SystemRoleName, PermissionKey[]> = {
  [SYSTEM_ROLES.OWNER]: [
    PERMISSIONS.DASHBOARD_ACCESS,
    PERMISSIONS.SYSTEM_ADMIN,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.COURTS_MANAGE,
    PERMISSIONS.BOOKINGS_MANAGE,
    PERMISSIONS.BOOKINGS_PAY_AT_VENUE,
    PERMISSIONS.OPEN_PLAY_MANAGE,
    PERMISSIONS.TOURNAMENTS_MANAGE,
    PERMISSIONS.PLAYERS_MANAGE,
    PERMISSIONS.EQUIPMENT_MANAGE,
    PERMISSIONS.REPORTS_MANAGE,
  ],
  [SYSTEM_ROLES.MANAGER]: [
    PERMISSIONS.DASHBOARD_ACCESS,
    PERMISSIONS.SYSTEM_ADMIN,
    PERMISSIONS.COURTS_MANAGE,
    PERMISSIONS.BOOKINGS_MANAGE,
    PERMISSIONS.BOOKINGS_PAY_AT_VENUE,
    PERMISSIONS.OPEN_PLAY_MANAGE,
    PERMISSIONS.TOURNAMENTS_MANAGE,
    PERMISSIONS.PLAYERS_MANAGE,
    PERMISSIONS.EQUIPMENT_MANAGE,
    PERMISSIONS.REPORTS_MANAGE,
  ],
  [SYSTEM_ROLES.RECEPTIONIST]: [
    PERMISSIONS.DASHBOARD_ACCESS,
    PERMISSIONS.BOOKINGS_MANAGE,
    PERMISSIONS.BOOKINGS_PAY_AT_VENUE,
    PERMISSIONS.OPEN_PLAY_MANAGE,
    PERMISSIONS.PLAYERS_MANAGE,
    PERMISSIONS.EQUIPMENT_MANAGE,
  ],
  [SYSTEM_ROLES.TOURNAMENT_DIRECTOR]: [
    PERMISSIONS.DASHBOARD_ACCESS,
    PERMISSIONS.TOURNAMENTS_MANAGE,
  ],
  [SYSTEM_ROLES.CAFE_STAFF]: [PERMISSIONS.DASHBOARD_ACCESS],
  [SYSTEM_ROLES.MEMBER]: [PERMISSIONS.DASHBOARD_ACCESS],
};

const OWNER_SEED_EMAIL = "owner@thecourtroom.local";
const OWNER_SEED_USERNAME = "owner";
const OWNER_SEED_PASSWORD = "Owner123!";

// A Receptionist-role login for local testing of shift/sales flows
// (booking, check-in, rentals) without using the Owner account — the
// Owner no longer clocks in for a shift day-to-day (see the Operations
// dashboard), so exercising that flow needs a real staff account.
const STAFF_SEED_EMAIL = "staff@thecourtroom.local";
const STAFF_SEED_USERNAME = "staff";
const STAFF_SEED_PASSWORD = "Staff123!";

// Phase 12: the system identity every public-website booking is
// attributed to (bookedById/employeeId/shiftId are all non-nullable —
// see ARCHITECTURE.md's PHASE 12 addendum for why this is a seeded
// identity rather than a schema change). Not a real login — no
// username/password, matching the paired User+Employee pattern Owner
// and staff already use, minus the auth fields. Email/payment-method
// key live in lib/system-identities.ts so the runtime lookup
// (services/booking/website-identity.ts) can't drift from this seed.
const WEBSITE_EMPLOYEE_NAME = { firstName: "The Courtroom", lastName: "Website" };

// Phase 2 seed data is limited to physical/reference fixtures — the things
// a facility inherently has (courts, lockers, an equipment catalog, plan
// tiers) — not transactional/operational data (bookings, tournaments,
// matches, rentals, payments), which stays empty until the corresponding
// business logic exists in a later phase.

interface MembershipPlanDefinition {
  description: string;
  priceCents: number;
  billingPeriod: BillingPeriod;
  discountPercent: number | null;
  priorityBooking: boolean;
}

// v1.1 Sub-phase 2: PaymentMethod is a real, admin-editable table (not a
// hardcoded enum) — this is only the out-of-the-box seed, not an exhaustive
// list; the Payment Methods workspace lets an Owner add more.
const PAYMENT_METHOD_DEFINITIONS: Array<{ key: string; label: string; sortOrder: number }> = [
  { key: "CASH", label: "Cash", sortOrder: 0 },
  { key: "GCASH", label: "GCash", sortOrder: 1 },
  { key: "BANK_TRANSFER", label: "Bank Transfer", sortOrder: 2 },
  { key: "CARD", label: "Credit/Debit Card", sortOrder: 3 },
  // Phase 12: the payment method attached to every public-website
  // booking (see the Website system identity below) — customers pay
  // in person, online payment is explicitly deferred (see
  // ARCHITECTURE.md's PHASE 12 addendum, Part I).
  { key: PAY_AT_VENUE_PAYMENT_METHOD_KEY, label: "Pay at Venue", sortOrder: 4 },
];

const MEMBERSHIP_PLAN_DEFINITIONS: Record<string, MembershipPlanDefinition> = {
  Silver: {
    description: "Entry-level membership with standard booking access.",
    priceCents: 150000,
    billingPeriod: "MONTHLY",
    discountPercent: null,
    priorityBooking: false,
  },
  Gold: {
    description: "Discounted court rates and extended booking windows.",
    priceCents: 250000,
    billingPeriod: "MONTHLY",
    discountPercent: 10,
    priorityBooking: false,
  },
  VIP: {
    description: "Maximum discount, priority booking, and locker access.",
    priceCents: 450000,
    billingPeriod: "MONTHLY",
    discountPercent: 20,
    priorityBooking: true,
  },
  Student: {
    description: "Discounted membership for students with a valid ID.",
    priceCents: 100000,
    billingPeriod: "MONTHLY",
    discountPercent: 15,
    priorityBooking: false,
  },
  Senior: {
    description: "Discounted membership for senior citizens.",
    priceCents: 100000,
    billingPeriod: "MONTHLY",
    discountPercent: 15,
    priorityBooking: false,
  },
};

// v1.1 Sub-phase 4: standardized to The Courtroom's actual, permanent
// 3-court layout (was 6, a Phase 2 placeholder never matched to the real
// facility). Courts 4-6 already seeded in any pre-existing database are
// not touched by this constant (upsert is keyed on name) — they were
// soft-retired via a one-time `status: DISABLED` data update instead of
// being deleted, preserving their historical booking/match data.
const COURT_COUNT = 3;
const COURT_HOURLY_RATE_CENTS = 35000;

// BUILD-SPEC.md §4: owner-editable from here on — this is only the
// starting default. dayOfWeek follows Date#getDay() (5 = Friday, 6 = Saturday).
const OPEN_PLAY_CAPACITY_DEFAULTS: Array<{ dayOfWeek: number; capacity: number }> = [
  { dayOfWeek: 5, capacity: 32 },
  { dayOfWeek: 6, capacity: 40 },
];

// v1.1: the two retail items The Courtroom actually sells outright today
// (SaleCategory.PRODUCT — see services/products/product.service.ts).
// Placeholder prices, intentionally rough — the whole point of the
// Product Catalog admin screen is that these are one click to correct.
const PRODUCT_DEFINITIONS: Array<{ name: string; priceCents: number; sortOrder: number }> = [
  { name: "Pickleballs", priceCents: 15000, sortOrder: 0 },
  { name: "T-Shirt", priceCents: 45000, sortOrder: 1 },
];

const LOCKER_COUNT = 20;

interface EquipmentDefinition {
  key?: string;
  type: EquipmentType;
  quantity: number;
  depositCents: number;
  rentalRateCents: number;
}

const EQUIPMENT_DEFINITIONS: Record<string, EquipmentDefinition> = {
  "House Paddle": {
    key: EQUIPMENT_KEYS.HOUSE_PADDLE,
    type: "PADDLE",
    quantity: 15,
    depositCents: 50000,
    rentalRateCents: 2000,
  },
  "Premium Paddle": { type: "PADDLE", quantity: 6, depositCents: 100000, rentalRateCents: 20000 },
  "Ball Sleeve (4-pack)": { type: "BALL", quantity: 30, depositCents: 0, rentalRateCents: 5000 },
  "Ball Machine": { type: "BALL_MACHINE", quantity: 2, depositCents: 500000, rentalRateCents: 50000 },
};

// Phase 6 addition: sample Player profiles (bare User + Player rows) so
// Tournament registration has real players to select from — there is no
// Player Profiles module yet for staff to create these themselves, and
// unlike Booking/Open Play, Tournament's Team model has no guest/walk-in
// concept (see ARCHITECTURE.md's Phase 6 addendum). Reference/test data
// only, same category as the Court/Locker/Equipment fixtures above.
interface SamplePlayerDefinition {
  name: string;
  email: string;
  skillLevel: SkillLevel;
}

const SAMPLE_PLAYER_DEFINITIONS: SamplePlayerDefinition[] = [
  { name: "Alex Santos", email: "alex.santos@players.thecourtroom.local", skillLevel: "ADVANCED" },
  { name: "Bea Cruz", email: "bea.cruz@players.thecourtroom.local", skillLevel: "ADVANCED" },
  { name: "Carlo Reyes", email: "carlo.reyes@players.thecourtroom.local", skillLevel: "INTERMEDIATE" },
  { name: "Dana Villanueva", email: "dana.villanueva@players.thecourtroom.local", skillLevel: "INTERMEDIATE" },
  { name: "Erik Bautista", email: "erik.bautista@players.thecourtroom.local", skillLevel: "PRO" },
  { name: "Faye Mendoza", email: "faye.mendoza@players.thecourtroom.local", skillLevel: "PRO" },
  { name: "Gio Fernandez", email: "gio.fernandez@players.thecourtroom.local", skillLevel: "BEGINNER" },
  { name: "Hana Torres", email: "hana.torres@players.thecourtroom.local", skillLevel: "BEGINNER" },
  { name: "Ivan Ramos", email: "ivan.ramos@players.thecourtroom.local", skillLevel: "INTERMEDIATE" },
  { name: "Jia Aquino", email: "jia.aquino@players.thecourtroom.local", skillLevel: "INTERMEDIATE" },
  { name: "Kyle Domingo", email: "kyle.domingo@players.thecourtroom.local", skillLevel: "ADVANCED" },
  { name: "Lena Castillo", email: "lena.castillo@players.thecourtroom.local", skillLevel: "ADVANCED" },
  { name: "Miko Navarro", email: "miko.navarro@players.thecourtroom.local", skillLevel: "BEGINNER" },
  { name: "Nadia Ocampo", email: "nadia.ocampo@players.thecourtroom.local", skillLevel: "PRO" },
];

// This script (re)creates the Owner account with a well-known password
// (OWNER_SEED_PASSWORD above) and is meant for local/staging setup only.
// Refuse to run against a production environment unless the operator
// explicitly opts in — prevents an accidental `npm run db:seed` from
// resetting a live production Owner account to a public, known password.
function assertSafeToSeed(): void {
  if (env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    logger.error(
      "Refusing to seed: NODE_ENV=production and ALLOW_PROD_SEED is not set to \"true\". " +
        "This script writes a well-known Owner password. If you really intend to seed " +
        "production (e.g. first-time setup), re-run with ALLOW_PROD_SEED=true and change " +
        "the Owner password immediately afterward.",
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertSafeToSeed();

  const roleByName = new Map<SystemRoleName, { id: string }>();

  for (const [name, definition] of Object.entries(ROLE_DEFINITIONS) as Array<
    [SystemRoleName, RoleDefinition]
  >) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { label: definition.label, description: definition.description, isSystem: true },
      create: { name, label: definition.label, description: definition.description, isSystem: true },
    });
    roleByName.set(name, role);
  }

  const permissionByKey = new Map<PermissionKey, { id: string }>();

  for (const [key, definition] of Object.entries(PERMISSION_DEFINITIONS) as Array<
    [PermissionKey, PermissionDefinition]
  >) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { label: definition.label, description: definition.description },
      create: { key, label: definition.label, description: definition.description },
    });
    permissionByKey.set(key, permission);
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSION_GRANTS) as Array<
    [SystemRoleName, PermissionKey[]]
  >) {
    const role = roleByName.get(roleName);
    if (!role) {
      continue;
    }

    for (const permissionKey of permissionKeys) {
      const permission = permissionByKey.get(permissionKey);
      if (!permission) {
        continue;
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const ownerRole = roleByName.get(SYSTEM_ROLES.OWNER);
  if (!ownerRole) {
    throw new Error("Owner role was not seeded.");
  }

  const memberRole = roleByName.get(SYSTEM_ROLES.MEMBER);
  if (!memberRole) {
    throw new Error("Member role was not seeded.");
  }

  // Deploy prep (BUILD-SPEC.md §0 process rule): `update` must NEVER
  // include `passwordHash`. This upsert runs on every seed invocation —
  // that's what makes the rest of this script safely idempotent — but a
  // credential is not like a role assignment or a catalog row. If an
  // operator bootstraps production with this well-known password, logs
  // in, and changes it (as DEPLOYMENT.md instructs), a second seed run
  // — deliberate or accidental, e.g. a redeploy pipeline that re-runs
  // this script with ALLOW_PROD_SEED still set from the bootstrap run —
  // would silently revert the real password back to this public,
  // known value. The password is set ONLY in `create`, i.e. only on a
  // database that has never had this Owner row before.
  const ownerExistedAlready = Boolean(await prisma.user.findUnique({ where: { email: OWNER_SEED_EMAIL } }));

  // Deploy prep: the fixed OWNER_SEED_PASSWORD ("Owner123!") is a real,
  // documented dev convenience (see docs/INSTALLATION.md) — kept as-is
  // outside production, where the account is always the same throwaway
  // one and predictability matters more than secrecy. In production,
  // now that the password is set exactly once and never reset (above),
  // a hardcoded default would become a PERMANENT weak credential unless
  // an operator remembers to change it — no longer just a convenience,
  // a standing vulnerability. Resolved in order: an explicit
  // OWNER_INITIAL_PASSWORD env var (for an operator who wants a specific
  // value, e.g. matching their password manager), else a fresh random
  // one, generated here and never hardcoded, printed exactly once below.
  const ownerPassword =
    env.NODE_ENV === "production"
      ? (process.env.OWNER_INITIAL_PASSWORD ?? randomBytes(16).toString("hex"))
      : OWNER_SEED_PASSWORD;
  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  const ownerUser = await prisma.user.upsert({
    where: { email: OWNER_SEED_EMAIL },
    update: { roleId: ownerRole.id },
    create: {
      email: OWNER_SEED_EMAIL,
      name: "Courtroom Owner",
      username: OWNER_SEED_USERNAME,
      passwordHash,
      roleId: ownerRole.id,
    },
  });

  // v1.1: paired Employee row (same User+profile-extension pattern as
  // Player) so Owner shows up correctly in the Employee workspace and can
  // use shifts like any other staff member.
  await prisma.employee.upsert({
    where: { userId: ownerUser.id },
    update: {},
    create: {
      userId: ownerUser.id,
      employeeNumber: "EMP-0001",
      firstName: "Courtroom",
      lastName: "Owner",
    },
  });

  // Owner's employeeNumber above is hardcoded rather than drawn from
  // nextSequence("EMPLOYEE"), so register it with the shared counter here —
  // otherwise the next nextSequence("EMPLOYEE") call also returns 1 and
  // collides with EMP-0001's unique constraint.
  await prisma.referenceCounter.upsert({
    where: { scope: "EMPLOYEE" },
    update: {},
    create: { scope: "EMPLOYEE", value: 1 },
  });

  if (ownerExistedAlready) {
    logger.info(
      { username: OWNER_SEED_USERNAME },
      "Owner account already exists — password left untouched",
    );
  } else {
    logger.info(
      { username: OWNER_SEED_USERNAME, password: ownerPassword },
      "Seeded Owner login — change this password immediately after first login",
    );
  }

  // Deploy prep (BUILD-SPEC.md §0 process rule): this is dev/test fixture
  // data — a known-password login and (further below) a pile of fake
  // players — never data a real production database should carry.
  // ALLOW_PROD_SEED only opts into the Owner bootstrap above; it was
  // never meant to also opt into a second, undocumented known-password
  // account. Gated on NODE_ENV directly, independent of ALLOW_PROD_SEED,
  // so there is no flag combination that lets this reach production —
  // the equivalent of this session's dev-database pairing-history
  // poisoning incident, but for a real credential instead of test data.
  if (env.NODE_ENV !== "production") {
    const receptionistRole = roleByName.get(SYSTEM_ROLES.RECEPTIONIST);
    if (!receptionistRole) {
      throw new Error("Receptionist role was not seeded.");
    }

    const staffPasswordHash = await bcrypt.hash(STAFF_SEED_PASSWORD, 12);

    const staffUser = await prisma.user.upsert({
      where: { email: STAFF_SEED_EMAIL },
      update: { passwordHash: staffPasswordHash, roleId: receptionistRole.id, username: STAFF_SEED_USERNAME },
      create: {
        email: STAFF_SEED_EMAIL,
        name: "Test Receptionist",
        username: STAFF_SEED_USERNAME,
        passwordHash: staffPasswordHash,
        roleId: receptionistRole.id,
      },
    });

    const existingStaffEmployee = await prisma.employee.findUnique({
      where: { userId: staffUser.id },
    });
    if (!existingStaffEmployee) {
      // Same shared atomic counter employeeService.createEmployee() uses —
      // avoids colliding with employeeNumbers already assigned to real
      // employees created live through the Employees admin workspace.
      const sequence = await nextSequence("EMPLOYEE");
      await prisma.employee.create({
        data: {
          userId: staffUser.id,
          employeeNumber: formatEmployeeNumber(sequence),
          firstName: "Test",
          lastName: "Receptionist",
        },
      });
    }

    logger.info(
      { username: STAFF_SEED_USERNAME, password: STAFF_SEED_PASSWORD },
      "Seeded Receptionist login for local development — never created in production",
    );
  } else {
    logger.info("Skipping dev-only Test Receptionist login — NODE_ENV=production");
  }

  const websiteUser = await prisma.user.upsert({
    where: { email: WEBSITE_SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: WEBSITE_SYSTEM_USER_EMAIL,
      name: "The Courtroom Website",
      roleId: memberRole.id,
      // No username/passwordHash — this identity can never sign in,
      // it's only ever referenced by id from the public booking action.
    },
  });

  let websiteEmployee = await prisma.employee.findUnique({ where: { userId: websiteUser.id } });
  if (!websiteEmployee) {
    const sequence = await nextSequence("EMPLOYEE");
    websiteEmployee = await prisma.employee.create({
      data: {
        userId: websiteUser.id,
        employeeNumber: formatEmployeeNumber(sequence),
        ...WEBSITE_EMPLOYEE_NAME,
      },
    });
  }

  // A single perpetually-open Shift — there's no person to clock it out.
  // Self-healing: only creates a new one if none is currently OPEN, so
  // this stays idempotent even if a future admin action ever closes it.
  const openWebsiteShift = await prisma.shift.findFirst({
    where: { employeeId: websiteEmployee.id, status: "OPEN" },
  });
  if (!openWebsiteShift) {
    const now = new Date();
    const sequence = await nextSequence(dailyScope("SHIFT", now));
    await prisma.shift.create({
      data: {
        shiftNumber: formatShiftNumber(now, sequence),
        employeeId: websiteEmployee.id,
        openingNotes: "Perpetual shift for public-website bookings — not a real cash drawer.",
      },
    });
  }

  logger.info("Seeded Website system identity (user/employee/shift) for public bookings");

  for (const [name, definition] of Object.entries(MEMBERSHIP_PLAN_DEFINITIONS)) {
    await prisma.membershipPlan.upsert({
      where: { name },
      update: definition,
      create: { name, ...definition },
    });
  }
  logger.info({ count: Object.keys(MEMBERSHIP_PLAN_DEFINITIONS).length }, "Seeded membership plans");

  for (const definition of PAYMENT_METHOD_DEFINITIONS) {
    await prisma.paymentMethod.upsert({
      where: { key: definition.key },
      update: { label: definition.label, sortOrder: definition.sortOrder },
      create: definition,
    });
  }
  logger.info({ count: PAYMENT_METHOD_DEFINITIONS.length }, "Seeded payment methods");

  for (const definition of PRODUCT_DEFINITIONS) {
    await prisma.product.upsert({
      where: { name: definition.name },
      update: { priceCents: definition.priceCents, sortOrder: definition.sortOrder },
      create: definition,
    });
  }
  logger.info({ count: PRODUCT_DEFINITIONS.length }, "Seeded products");

  for (let i = 1; i <= COURT_COUNT; i += 1) {
    const name = `Court ${i}`;
    await prisma.court.upsert({
      where: { name },
      update: { hourlyRateCents: COURT_HOURLY_RATE_CENTS },
      create: { name, indoor: true, hourlyRateCents: COURT_HOURLY_RATE_CENTS },
    });
  }
  logger.info({ count: COURT_COUNT }, "Seeded courts");

  for (let i = 1; i <= LOCKER_COUNT; i += 1) {
    const code = `L-${String(i).padStart(2, "0")}`;
    await prisma.locker.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }
  logger.info({ count: LOCKER_COUNT }, "Seeded lockers");

  for (const [name, definition] of Object.entries(EQUIPMENT_DEFINITIONS)) {
    await prisma.equipment.upsert({
      where: { name },
      update: definition,
      create: { name, ...definition },
    });
  }
  logger.info({ count: Object.keys(EQUIPMENT_DEFINITIONS).length }, "Seeded equipment catalog");

  for (const definition of OPEN_PLAY_CAPACITY_DEFAULTS) {
    await prisma.openPlayCapacityDefault.upsert({
      where: { dayOfWeek: definition.dayOfWeek },
      update: { capacity: definition.capacity },
      create: definition,
    });
  }
  logger.info({ count: OPEN_PLAY_CAPACITY_DEFAULTS.length }, "Seeded open play capacity defaults");

  // Deploy prep: same dev-only gating as the Test Receptionist above —
  // fake players with fake @players.thecourtroom.local emails have no
  // place in a real production player list.
  if (env.NODE_ENV !== "production") {
    for (const definition of SAMPLE_PLAYER_DEFINITIONS) {
      const user = await prisma.user.upsert({
        where: { email: definition.email },
        update: { name: definition.name, roleId: memberRole.id },
        create: { email: definition.email, name: definition.name, roleId: memberRole.id },
      });

      await prisma.player.upsert({
        where: { userId: user.id },
        update: { skillLevel: definition.skillLevel },
        create: { userId: user.id, skillLevel: definition.skillLevel },
      });
    }
    logger.info({ count: SAMPLE_PLAYER_DEFINITIONS.length }, "Seeded sample players");
  } else {
    logger.info("Skipping dev-only sample players — NODE_ENV=production");
  }
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "Database seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
