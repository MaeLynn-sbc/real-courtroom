import { computeBusinessDate, getBusinessDateRange } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { openPlayRotationService } from "@/services/open-play/open-play-rotation.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §12 — the ONLY thing app/display/[slug] and
// app/api/display are allowed to read. Every field here is already
// public-safe: no skill level, no phone/email, no payment/verification
// state, no full names (shortDisplayName runs before anything leaves
// this file — see the module comment on shortDisplayName below).

export interface DisplayPlayer {
  name: string;
}

export interface DisplayNextBooking {
  name: string;
  startAt: string;
}

// A discriminated union on `state` (rather than one shape with nullable
// startAt/endAt) so a court that's actually occupied can never be
// rendered without a start/end time by construction — the client
// narrows on `state` and never needs a non-null assertion to read them.
export interface DisplayCourtFree {
  id: string;
  name: string;
  state: "free";
  players: [];
  startAt: null;
  endAt: null;
  // The next upcoming booking on this court today, if any.
  next: DisplayNextBooking | null;
}

export interface DisplayCourtActive {
  id: string;
  name: string;
  // res: currently booked. op: an open-play game in progress.
  state: "res" | "op";
  // res: the one booking guest/player. op: up to 4 checked-in
  // participants.
  players: DisplayPlayer[];
  startAt: string;
  endAt: string;
  // res: the booking after this one on the same court, if any today.
  // op: always null — the queue is one shared pool, not tied to a
  // specific court, so open play has no per-court "next" (BUILD-SPEC.md
  // §12 "tying the next four to a specific court would be wrong").
  next: DisplayNextBooking | null;
}

export type DisplayCourt = DisplayCourtFree | DisplayCourtActive;

export interface DisplayData {
  generatedAt: string;
  targetGameMinutes: number;
  courts: DisplayCourt[];
  // Flattened wait-order names (parties expand to their members,
  // adjacent, in the unit's position) — same flat shape the reference
  // design's demo DATA.queue already used.
  queue: string[];
}

// Names arrive at the client pre-shortened — BUILD-SPEC.md §12 "Enforce
// by excluding the fields... not by omitting them in the template." A
// user.name fallback can occasionally be a bare email (no display name
// set) — split()'d on whitespace alone that would render whole on
// screen, so it gets its own branch rather than falling through to the
// "first token + last initial" logic below.
function shortDisplayName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) {
    return "Guest";
  }
  if (trimmed.includes("@")) {
    return trimmed.split("@")[0] || "Guest";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Mirrors reporting.service.ts's private playerDisplayName — duplicated
// rather than imported/exported, same precedent as this codebase's other
// small per-service query/formatting helpers (see booking.service.ts's
// toJsonValue comment).
function bookingDisplayName(booking: {
  guestName: string | null;
  player: { user: { name: string | null; email: string | null } } | null;
}): string | null {
  if (booking.player) {
    return booking.player.user.name ?? booking.player.user.email;
  }
  return booking.guestName;
}

type CourtBooking = Awaited<ReturnType<typeof fetchRelevantBookings>>[number];

// Same "what counts as an active, slot-occupying booking" where-clause
// as booking.service.ts's private checkAvailabilityWithClient (notIn
// CANCELLED/NO_SHOW/REJECTED, expired AWAITING_PAYMENT holds excluded)
// — duplicated, not imported, since that method is private to
// BookingService and this is a read-only display concern, not a
// booking-mutation one.
async function fetchRelevantBookings(courtIds: string[], now: Date, windowEnd: Date) {
  return prisma.booking.findMany({
    where: {
      courtId: { in: courtIds },
      status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
      OR: [{ status: { not: "AWAITING_PAYMENT" } }, { holdExpiresAt: null }, { holdExpiresAt: { gte: now } }],
      startAt: { lt: windowEnd },
      endAt: { gt: now },
    },
    select: {
      id: true,
      courtId: true,
      startAt: true,
      endAt: true,
      guestName: true,
      player: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { startAt: "asc" },
  });
}

function toDisplayNextBooking(booking: CourtBooking | undefined): DisplayNextBooking | null {
  if (!booking) {
    return null;
  }
  return {
    name: shortDisplayName(bookingDisplayName(booking)),
    startAt: booking.startAt.toISOString(),
  };
}

export class DisplayService {
  // BUILD-SPEC.md §12/§13. Reuses getRotationBoardData (§7's existing,
  // shared court/queue aggregation) for open-play state, and adds one
  // new query this codebase didn't have yet: current + next booking per
  // court, needed for the reservation half of the grid.
  async getDisplayData(): Promise<DisplayData> {
    const courtHours = await settingsService.getCourtHours();
    const now = new Date();
    const businessDate = computeBusinessDate(now, courtHours.businessDateRolloverHour);
    const { end: businessDateEnd } = getBusinessDateRange(businessDate, courtHours.businessDateRolloverHour);

    const [rotationBoard, settings, allCourts] = await Promise.all([
      openPlayRotationService.getRotationBoardData(businessDate),
      settingsService.getOpenPlaySettings(),
      prisma.court.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    ]);

    const activeCourtIds = allCourts.map((court) => court.id);
    const bookings = await fetchRelevantBookings(activeCourtIds, now, businessDateEnd);

    const currentByCourtId = new Map<string, CourtBooking>();
    const nextByCourtId = new Map<string, CourtBooking>();
    for (const booking of bookings) {
      if (booking.startAt.getTime() <= now.getTime()) {
        if (!currentByCourtId.has(booking.courtId)) {
          currentByCourtId.set(booking.courtId, booking);
        }
      } else if (!nextByCourtId.has(booking.courtId)) {
        nextByCourtId.set(booking.courtId, booking);
      }
    }

    const boardByCourtId = new Map(rotationBoard.courts.map((entry) => [entry.court.id, entry]));

    const courts: DisplayCourt[] = allCourts.map((court) => {
      const currentBooking = currentByCourtId.get(court.id);
      const nextBooking = nextByCourtId.get(court.id);

      if (currentBooking) {
        return {
          id: court.id,
          name: court.name,
          state: "res",
          players: [{ name: shortDisplayName(bookingDisplayName(currentBooking)) }],
          startAt: currentBooking.startAt.toISOString(),
          endAt: currentBooking.endAt.toISOString(),
          next: toDisplayNextBooking(nextBooking),
        };
      }

      const activeAssignment = boardByCourtId.get(court.id)?.active ?? null;
      if (activeAssignment) {
        const start = activeAssignment.startedAt ?? activeAssignment.proposedAt;
        const end = new Date(start.getTime() + settings.targetGameMinutes * 60_000);
        return {
          id: court.id,
          name: court.name,
          state: "op",
          players: activeAssignment.participants.map((participant) => ({
            name: shortDisplayName(participant.registration.playerName),
          })),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          next: null,
        };
      }

      return {
        id: court.id,
        name: court.name,
        state: "free",
        players: [],
        startAt: null,
        endAt: null,
        next: toDisplayNextBooking(nextBooking),
      };
    });

    const queue = rotationBoard.waiting.flatMap((unit) =>
      unit.members.map((member) => shortDisplayName(member.playerName)),
    );

    return {
      generatedAt: now.toISOString(),
      targetGameMinutes: settings.targetGameMinutes,
      courts,
      queue,
    };
  }
}

export const displayService = new DisplayService();
