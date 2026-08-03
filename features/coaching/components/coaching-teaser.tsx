import Link from "next/link";

import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";

// "Compact teaser + link" (owner, 2026-08-03): each coach's name + their
// NEXT available slot, plus a button to the full /coaches/availability
// page for the complete 14-day breakdown — not a day-by-day grid embedded
// in the home page itself. Data fetching lives here, not app/page.tsx,
// same precedent as CourtAvailabilityGrid: every section on the home page
// owns its own Prisma-backed reads.
//
// Reuses listPublicAvailability's own DAYS_AHEAD window (matches
// app/coaches/availability/page.tsx's DAYS_AHEAD) — windows come back
// already sorted chronologically with every booked CoachSession
// subtracted out (including a stale, unresolved hold, fixed 2026-08-03
// alongside this feature — see the function's own comment), so
// windows[0] is always the coach's genuine next free slot.
const DAYS_AHEAD = 14;

const dayFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatNextSlotDay(startAt: Date): string {
  const now = new Date();
  if (isSameLocalDay(startAt, now)) {
    return "Today";
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameLocalDay(startAt, tomorrow)) {
    return "Tomorrow";
  }
  return dayFormatter.format(startAt);
}

export async function CoachingTeaser() {
  const availability = await coachAvailabilityService.listPublicAvailability(DAYS_AHEAD);

  if (availability.length === 0) {
    return null;
  }

  return (
    <section id="coaching" className="border-line border-t px-6 py-[clamp(56px,7vw,90px)]">
      <div className="mx-auto max-w-6xl">
        <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
          Level up your game
        </span>
        <h2 className="font-display text-bone mt-2 text-[clamp(30px,4.4vw,52px)] leading-[0.94] font-extrabold tracking-[-0.01em] uppercase">
          Coaching
        </h2>
        <p className="text-slate mt-3 max-w-[52ch] text-sm">
          Private lessons with our coaches. Add one when you book a court, or check the full
          schedule below.
        </p>

        <div className="mt-8 grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
          {availability.map((coach) => {
            const nextSlot = coach.windows[0];
            return (
              <div key={coach.coachId} className="border-line bg-navy-800 rounded-2xl border p-6">
                <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                  Next available
                </span>
                <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                  {coach.coachName}
                </h3>
                <p className="text-slate mt-2 text-[14.5px]">
                  {formatNextSlotDay(nextSlot.startAt)}, {timeFormatter.format(nextSlot.startAt)}–
                  {timeFormatter.format(nextSlot.endAt)}
                </p>
              </div>
            );
          })}
        </div>

        <Link
          href="/coaches/availability"
          className="border-line text-bone hover:border-green mt-6 inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-bold transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          See full 2-week schedule
        </Link>
      </div>
    </section>
  );
}
