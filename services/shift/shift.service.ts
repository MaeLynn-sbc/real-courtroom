import type { EndShiftInput, StartShiftInput } from "@/features/shifts/schemas/shift.schema";
import type { Prisma, Shift } from "@/lib/generated/prisma/client";
import { sumCashDenominationBreakdown } from "@/lib/cash-denominations";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { WEBSITE_SYSTEM_USER_EMAIL } from "@/lib/system-identities";
import { saleService } from "@/services/sales/sale.service";
import { formatShiftNumber } from "@/services/shift/shift-number";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export class ShiftAlreadyOpenError extends Error {
  constructor() {
    super("This employee already has an open shift. End it before starting a new one.");
    this.name = "ShiftAlreadyOpenError";
  }
}

// Approving a payment verification (booking or open-play) — reported
// live: the Owner needing an open shift just to approve a GCash payment
// from home was pure friction. Unlike booking creation
// (requireEmployeeForBookingCreation, lib/action-auth.ts), there's no
// "skip the shift" option here — Sale.shiftId is a required column,
// since approving creates a real Sale immediately. Standalone (no
// auth()/session dependency) so it's directly testable, same shape as
// services/booking/website-identity.ts's getWebsiteBookingContext.
const NOT_A_CASH_DRAWER_MARKER = "Payment-approval attribution shift — not a real cash drawer.";

export class ShiftService {
  async getCurrentShift(employeeId: string) {
    return prisma.shift.findFirst({
      where: { employeeId, status: "OPEN" },
      orderBy: { startedAt: "desc" },
    });
  }

  // Always a per-employee perpetual CLOSED shift, reused across calls
  // (found by its own marker note) rather than creating a new throwaway
  // row every approval — never the approver's real open shift, even when
  // they have one. Reported live (2026-08-07): a customer's online GCash
  // payment could sit unapproved across a shift change, then land in
  // whichever employee's shift happened to be OPEN at approval time —
  // sometimes a different employee than whoever was on duty when the
  // booking was actually made, hours or days earlier — inflating that
  // employee's "My Shift" total with money they never handled. This path
  // is GCash-only (see resolveGcashPaymentMethodId), so it never touches
  // a physical drawer either way; there's no cash-reconciliation reason
  // to prefer a real shift when one happens to be open.
  // Sale.employeeId still records who approved, independent of shiftId —
  // audit trail is unaffected. Deliberately CLOSED, not OPEN, so
  // approving a payment can never make someone show up as "on duty" —
  // every "who's on duty" query in this app filters on status = OPEN.
  async resolveShiftForSaleAttribution(employeeId: string): Promise<Shift> {
    const existingExemptShift = await prisma.shift.findFirst({
      where: { employeeId, status: "CLOSED", openingNotes: { startsWith: NOT_A_CASH_DRAWER_MARKER } },
    });
    if (existingExemptShift) {
      return existingExemptShift;
    }

    const now = new Date();
    const sequence = await nextSequence(dailyScope("SHIFT", now));
    return prisma.shift.create({
      data: {
        shiftNumber: formatShiftNumber(now, sequence),
        employeeId,
        status: "CLOSED",
        openingNotes: NOT_A_CASH_DRAWER_MARKER,
        closingNotes: NOT_A_CASH_DRAWER_MARKER,
        endedAt: now,
        closingCashCents: 0,
        varianceCents: 0,
      },
    });
  }

  // Employee included (firstName/lastName, no extra join cost — plain
  // columns) so this same shape works whether the caller is looking at
  // their own name-redundant history or (listAllShiftsForReview, below)
  // everyone's — one row type for the Recent Shifts table either way.
  async listShifts(employeeId: string, limit = 10) {
    return prisma.shift.findMany({
      where: { employeeId },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // REPORTS_MANAGE follow-up: staff still only ever see listShifts's
  // own-employee-scoped history above — this is the permission-gated
  // path so an owner/manager can review ANY employee's shift, not just
  // their own, the actual reason the shift-detail page's denomination
  // breakdown was worth building. The permission check itself belongs
  // to the caller (app/dashboard/shift/page.tsx), same split as
  // getShiftById's own ownership check — this method only knows "all
  // shifts," not "who's allowed to ask for them."
  async listAllShiftsForReview(limit = 20) {
    return prisma.shift.findMany({
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // "Who's on duty" — every currently OPEN shift, oldest-clocked-in
  // first (matches how a physical sign-in sheet reads). One open shift
  // per employee is enforced in startShift, so this is naturally one
  // row per on-duty employee, never a duplicate.
  //
  // Excludes the seeded "Website" system identity (services/booking/
  // website-identity.ts) — it self-heals a PERPETUAL open Shift for
  // attributing public-website bookings, "not a real cash drawer" per
  // its own comment, and would otherwise show as permanently on duty
  // forever, defeating the point of an at-a-glance "who's actually at
  // the desk right now" indicator. Filtered by the system user's
  // seeded email (the same identifier website-identity.ts itself uses
  // to resolve it), not a name-based guess.
  // Reported live: every staff member with no email on file (a real,
  // supported case — a staff account doesn't require one, see
  // features/employees/schemas/employee.schema.ts's own comment) was
  // silently invisible in the "who's on duty" dropdown. `email: { not:
  // X }` compiles to SQL `<>`, and NULL <> 'x' evaluates to UNKNOWN, not
  // TRUE — Postgres excludes the row entirely, not just from matching X.
  // Confirmed against real production data: two genuinely on-duty
  // attendants, both with email: null, both silently missing. Explicit
  // OR handles both cases: no email at all is trivially "not the
  // website account," and a real email just has to not equal it.
  async listOpenShiftsWithEmployee() {
    return prisma.shift.findMany({
      where: {
        status: "OPEN",
        employee: { user: { OR: [{ email: null }, { email: { not: WEBSITE_SYSTEM_USER_EMAIL } }] } },
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { startedAt: "asc" },
    });
  }

  // Gap #4 fix: a closed shift's denomination breakdown and closing
  // note were persisted but never surfaced anywhere past the moment
  // of closing — reviewing a questioned variance days later meant
  // direct DB access. Includes the employee (firstName/lastName are
  // plain columns on Employee, no extra join cost) so the detail page
  // can show who worked the shift without a second query. Ownership
  // (only the shift's own employee may view it) is enforced by the
  // caller, same as every other read here — this method itself has no
  // concept of "viewer," only "which shift."
  async getShiftById(shiftId: string) {
    return prisma.shift.findUnique({
      where: { id: shiftId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
  }

  // "Only one OPEN shift per employee" is enforced here (checked fresh
  // before creating) — multiple CLOSED shifts on the same day are fine.
  // v1.1 maintenance: shiftNumber now comes from the shared atomic
  // counter (lib/reference-counter.ts), so it can no longer collide —
  // the retry loop this used to need solely for that is gone.
  async startShift(employeeId: string, input: StartShiftInput, actorUserId: string) {
    const existingOpen = await this.getCurrentShift(employeeId);
    if (existingOpen) {
      throw new ShiftAlreadyOpenError();
    }

    const now = new Date();
    const sequence = await nextSequence(dailyScope("SHIFT", now));
    const shiftNumber = formatShiftNumber(now, sequence);

    const shift = await prisma.shift.create({
      data: {
        shiftNumber,
        employeeId,
        openingCashCents: input.openingCashCents,
        openingNotes: input.openingNotes,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift.started",
      entityType: "Shift",
      entityId: shift.id,
      newValues: shift,
    });

    return shift;
  }

  // Gate 1: openingCashCents + cash-only Sales for this shift — what the
  // drawer SHOULD hold before anyone counts it. Exposed separately (not
  // just inlined into endShift) so the close-shift screen can show this
  // to staff BEFORE they enter their physical count, same "expected"
  // wording end-to-end.
  async getExpectedCashForShift(shift: Pick<Shift, "id" | "openingCashCents">): Promise<number> {
    const cashSales = await saleService.getCashSalesForShift(shift.id);
    return shift.openingCashCents + cashSales.totalAmountCents;
  }

  // Gate 1 (fix for the existing gap): varianceCents now actually gets
  // computed and written — variance = closingCash - (openingCash +
  // cashSales), exactly the formula this column's own comment described
  // when it was added but never wired up. closingCashCents is computed
  // HERE, from the denomination breakdown the client submitted, never
  // trusted as a client-sent total — same reasoning as every Sale-
  // creating action in this app not trusting client-computed amounts.
  async endShift(shiftId: string, input: EndShiftInput, actorUserId: string) {
    const existing = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });

    if (existing.status !== "OPEN") {
      throw new Error("This shift is already closed.");
    }

    const closingCashCents = sumCashDenominationBreakdown(input.closingCashBreakdown);
    const expectedCashCents = await this.getExpectedCashForShift(existing);
    const varianceCents = closingCashCents - expectedCashCents;

    // "If there's a variance, require a note" — enforced here, not in
    // the zod schema, since only this method knows the variance (it
    // depends on a live Sale query the schema layer can't see).
    if (varianceCents !== 0 && !input.closingNotes?.trim()) {
      throw new Error(
        `Counted cash doesn't match the expected amount (${varianceCents > 0 ? "+" : ""}${(varianceCents / 100).toFixed(2)} PHP). Enter a note explaining the difference before closing.`,
      );
    }

    const shift = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: "CLOSED",
        closingCashCents,
        closingCashBreakdown: input.closingCashBreakdown,
        varianceCents,
        closingNotes: input.closingNotes,
        endedAt: new Date(),
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift.ended",
      entityType: "Shift",
      entityId: shift.id,
      oldValues: existing,
      newValues: shift,
    });

    return shift;
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const shiftService = new ShiftService();
