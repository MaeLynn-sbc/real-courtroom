import { prisma } from "@/lib/prisma";

// Owner request (2026-08-09): a display for Special Open Play — "a
// button to call out their names, and different url for their display."
// Deliberately its own, isolated service — reads only
// SpecialOpenPlayCheckIn (see that model's own schema comment), zero
// overlap with displayService (the real Open Play TV) or
// tournamentDisplayService. "First L." shortened names, same
// BUILD-SPEC.md §12 public-display convention as every other kiosk
// display in this app, even though this one currently lives behind a
// temporary /tourtv URL rather than its own.

export interface SpecialDisplayCourt {
  courtLabel: string;
  playerNames: string[];
  announcementRequestedAt: string | null;
  timesUpRequestedAt: string | null;
}

export interface SpecialDisplayData {
  generatedAt: string;
  courts: SpecialDisplayCourt[];
  waitingNames: string[];
}

const COURT_LABELS = ["Court 1", "Court 2", "Court 3"] as const;

function shortDisplayName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return "Guest";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export class SpecialDisplayService {
  async getDisplayData(date: Date): Promise<SpecialDisplayData> {
    const checkIns = await prisma.specialOpenPlayCheckIn.findMany({
      where: { date, status: { in: ["WAITING", "PLAYING"] } },
      orderBy: { checkedInAt: "asc" },
    });

    const courts: SpecialDisplayCourt[] = COURT_LABELS.map((courtLabel) => {
      const occupants = checkIns.filter((c) => c.status === "PLAYING" && c.courtLabel === courtLabel);
      return {
        courtLabel,
        playerNames: occupants.map((o) => shortDisplayName(o.playerName)),
        // All occupants of a court are stamped together (see
        // special-open-play.service.ts's announceCourt/announceTimesUp) —
        // any one of them carries the shared token.
        announcementRequestedAt: occupants[0]?.announcementRequestedAt?.toISOString() ?? null,
        timesUpRequestedAt: occupants[0]?.timesUpRequestedAt?.toISOString() ?? null,
      };
    });

    const waitingNames = checkIns
      .filter((c) => c.status === "WAITING")
      .map((c) => shortDisplayName(c.playerName));

    return { generatedAt: new Date().toISOString(), courts, waitingNames };
  }
}

export const specialDisplayService = new SpecialDisplayService();
