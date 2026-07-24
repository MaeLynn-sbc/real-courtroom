import { getFacilityCloseMinutes } from "@/lib/court-hours";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { OpenPlayCapacityDefault, OpenPlayNightSession, Prisma } from "@/lib/generated/prisma/client";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §4 — Friday/Saturday only. See prisma/schema.prisma's
// comment above OpenPlayCapacityDefault/OpenPlayNightSession for why this
// is a separate model set from the existing OpenPlaySession rotation
// feature (services/open-play/session.service.ts), not an extension of it.
const OPEN_PLAY_DAYS_OF_WEEK = [5, 6] as const;
type OpenPlayDayOfWeek = (typeof OPEN_PLAY_DAYS_OF_WEEK)[number];

function isOpenPlayDayOfWeek(dayOfWeek: number): dayOfWeek is OpenPlayDayOfWeek {
  return (OPEN_PLAY_DAYS_OF_WEEK as readonly number[]).includes(dayOfWeek);
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Date#setMinutes normalizes overflow itself (e.g. 1440 rolls to the next
// calendar day's 00:00), so a facility close of "00:00" (midnight) doesn't
// need special-casing here the way lib/court-hours.ts has to for booking
// windows.
function atMinutesOfDay(date: Date, minutes: number): Date {
  const result = toMidnight(date);
  result.setMinutes(minutes);
  return result;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface UpcomingOpenPlayNight {
  date: Date;
  dayOfWeek: OpenPlayDayOfWeek;
  capacity: number;
  isOverride: boolean;
  status: OpenPlayNightSession["status"] | null;
}

export class OpenPlayCapacityService {
  async getCapacityDefaults(): Promise<OpenPlayCapacityDefault[]> {
    return prisma.openPlayCapacityDefault.findMany({ orderBy: { dayOfWeek: "asc" } });
  }

  // BUILD-SPEC.md §4 "Accept any positive integer. Do not cap input at 40"
  // — validated by the caller's zod schema, not re-validated here.
  async setCapacityDefault(
    dayOfWeek: OpenPlayDayOfWeek,
    capacity: number,
    actorUserId: string,
  ): Promise<OpenPlayCapacityDefault> {
    const existing = await prisma.openPlayCapacityDefault.findUnique({ where: { dayOfWeek } });

    const updated = await prisma.openPlayCapacityDefault.upsert({
      where: { dayOfWeek },
      update: { capacity },
      create: { dayOfWeek, capacity },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_capacity_default.updated",
      entityType: "OpenPlayCapacityDefault",
      entityId: updated.id,
      oldValues: existing ? { capacity: existing.capacity } : null,
      newValues: { dayOfWeek, capacity },
    });

    return updated;
  }

  // "One per date. Created on demand from the weekday default" — nothing
  // pre-populates future Friday/Saturday rows; this is the sole entry
  // point that materializes one, called either by an owner setting a
  // per-date override (Phase 3) or by registration once that exists
  // (Phase 4).
  async getOrCreateSessionForDate(rawDate: Date): Promise<OpenPlayNightSession> {
    const date = toMidnight(rawDate);
    const dayOfWeek = date.getDay();
    if (!isOpenPlayDayOfWeek(dayOfWeek)) {
      throw new Error("Open play nights only exist for Friday and Saturday.");
    }

    const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
    if (existing) {
      return existing;
    }

    const [capacityDefault, courtHours] = await Promise.all([
      prisma.openPlayCapacityDefault.findUnique({ where: { dayOfWeek } }),
      settingsService.getCourtHours(),
    ]);
    if (!capacityDefault) {
      // Seed data is expected to always have Fri/Sat rows — a missing one
      // is a real configuration bug, not something to silently guess a
      // fallback capacity for.
      throw new Error(`No OpenPlayCapacityDefault configured for day ${dayOfWeek} — check prisma/seed.ts.`);
    }

    const startAt = atMinutesOfDay(date, parseTimeToMinutes(courtHours.fridaySaturdayCloseTime));
    const endAt = atMinutesOfDay(date, getFacilityCloseMinutes(courtHours, date));

    return prisma.openPlayNightSession.create({
      data: { date, startAt, endAt, capacity: capacityDefault.capacity },
    });
  }

  // Sets (creating the row on demand if needed) a specific date's capacity
  // independently of the weekday default — BUILD-SPEC.md §4 "Owner can
  // override a single date without changing the default."
  //
  // Phase 4 note: once OpenPlayNightRegistration exists, this must reject
  // lowering capacity below the confirmed-registration count for this
  // session ("fail loudly... tell the owner how many are registered") —
  // there's nothing to count yet, so that guard isn't implemented here.
  async setSessionCapacityOverride(date: Date, capacity: number, actorUserId: string): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);

    const updated = await prisma.openPlayNightSession.update({
      where: { id: session.id },
      data: { capacity },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.capacity_overridden",
      entityType: "OpenPlayNightSession",
      entityId: updated.id,
      oldValues: { capacity: session.capacity },
      newValues: { date: updated.date, capacity },
    });

    return updated;
  }

  // Upcoming Friday/Saturday dates for the owner-facing overrides UI —
  // doesn't materialize a session row just for viewing; `isOverride`
  // distinguishes "already has its own row" from "would inherit today's
  // default if a session were created right now."
  async getUpcomingNights(count: number): Promise<UpcomingOpenPlayNight[]> {
    const dates: Date[] = [];
    const cursor = toMidnight(new Date());
    while (dates.length < count) {
      if (isOpenPlayDayOfWeek(cursor.getDay())) {
        dates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const [sessions, defaults] = await Promise.all([
      prisma.openPlayNightSession.findMany({ where: { date: { in: dates } } }),
      this.getCapacityDefaults(),
    ]);
    const sessionsByDate = new Map(sessions.map((session) => [session.date.getTime(), session]));
    const defaultsByDay = new Map(defaults.map((row) => [row.dayOfWeek, row.capacity]));

    return dates.map((date) => {
      const dayOfWeek = date.getDay() as OpenPlayDayOfWeek;
      const session = sessionsByDate.get(date.getTime());
      return {
        date,
        dayOfWeek,
        capacity: session?.capacity ?? defaultsByDay.get(dayOfWeek) ?? 0,
        isOverride: Boolean(session),
        status: session?.status ?? null,
      };
    });
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
      logger.error({ err: error, action: entry.action, userId: entry.actorUserId }, "Failed to write audit log entry");
    }
  }
}

export const openPlayCapacityService = new OpenPlayCapacityService();
