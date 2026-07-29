"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { copyWeekAvailabilityAction, setDayAvailabilityAction } from "@/actions/coaching.actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HourGrid, type HourCellState } from "@/components/shared/hour-grid";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";
import { getFacilityCloseMinutes } from "@/lib/court-hours";
import { expandWindowToHours, mergeHoursIntoWindows } from "@/lib/hour-windows";
import { cn } from "@/lib/utils";
import type { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import type { coachSessionService } from "@/services/coaching/coach-session.service";

type Coach = Awaited<ReturnType<typeof coachAvailabilityService.listCoaches>>[number];
type ActiveSession = Awaited<ReturnType<typeof coachSessionService.listActiveSessionsForCoach>>[number];

// Only startAt/endAt ever get read anywhere below — a narrower local
// shape than the full service row, so optimistic entries synthesized
// client-side (which have no real id/coachId/notes yet) satisfy the
// same type as the server-fetched ones.
interface WindowLike {
  id: string;
  startAt: Date;
  endAt: Date;
}

const weekdayFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short" });
const dayHeadingFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric" });

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + diff);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const personDateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

function sessionCustomerName(session: ActiveSession): string {
  return session.player?.user.name ?? session.player?.user.email ?? session.guestName ?? "Guest";
}

interface CoachAvailabilityManagerProps {
  coaches: Coach[];
  selectedCoachId: string;
  isOwnCalendar: boolean;
  windows: WindowLike[];
  activeSessions: ActiveSession[];
  courtHours: CourtHoursSettings;
}

export function CoachAvailabilityManager({
  coaches,
  selectedCoachId,
  isOwnCalendar,
  windows: windowsProp,
  activeSessions,
  courtHours,
}: CoachAvailabilityManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(today));
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [pendingClear, setPendingClear] = useState<{ hour: number; sessions: ActiveSession[] } | null>(null);

  // Local, optimistically-updated mirror of the server-fetched windows.
  // Two layers, found necessary live, in order:
  //   1. router.refresh() doesn't extend useTransition's isPending
  //      across its own async refetch, only across the awaited action
  //      call before it — a tap right after the grid re-enabled but
  //      before the refreshed `windows` prop had landed computed its
  //      "next hours" from stale data, silently dropping the previous
  //      tap. Fixed by updating a local copy immediately instead of
  //      waiting on the prop.
  //   2. That local copy, if read back out of a useMemo/closure the
  //      way the state itself is, is STILL stale for two clicks fired
  //      close enough together that React hasn't re-rendered between
  //      them (real with fast/automated clicking, not just a human
  //      mashing the grid) — a memo computed at render N doesn't see
  //      what a click during render N itself just wrote. windowsRef is
  //      the actual source of truth commitToggle reads from: a plain
  //      ref, mutated synchronously in the same tick as the click,
  //      never subject to batching or a stale render's closure. The
  //      `windows` state below exists only to trigger a re-render for
  //      display — every real read for "what hours are on right now"
  //      goes through the ref.
  const windowsRef = useRef<WindowLike[]>(windowsProp);
  const [windows, setWindows] = useState<WindowLike[]>(windowsProp);
  useEffect(() => {
    windowsRef.current = windowsProp;
    setWindows(windowsProp);
  }, [windowsProp]);

  // Debounces the actual SAVE (not the optimistic display, which is
  // already instant via windowsRef) per calendar day. Found live, one
  // layer past the ref fix above: tapping several hours in a burst
  // used to fire one setDayAvailabilityAction + router.refresh() per
  // tap — independent server round-trips with no ordering guarantee
  // between them. Whichever one's refresh happened to resolve LAST won,
  // silently overwriting a newer optimistic change with an older
  // server snapshot that didn't have it yet, even though the ref logic
  // above was already correct. Collapsing a burst of taps on the same
  // day into exactly one request after a short quiet period removes
  // the "multiple in-flight requests for one day" case entirely, not
  // just the client-side symptom of it. Keyed by day so tapping
  // different days doesn't cancel each other's pending saves.
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const SAVE_DEBOUNCE_MS = 500;

  function scheduleSave(date: Date, hours: number[]) {
    const key = date.toDateString();
    const existing = saveTimersRef.current.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      saveTimersRef.current.delete(key);
      startTransition(async () => {
        const result = await setDayAvailabilityAction({ coachId: selectedCoachId, date, hours });
        if (result.error) {
          toast.error(result.error);
          windowsRef.current = windowsProp;
          setWindows(windowsProp);
          return;
        }
        router.refresh();
      });
    }, SAVE_DEBOUNCE_MS);
    saveTimersRef.current.set(key, timer);
  }

  function hoursForDay(source: WindowLike[], date: Date): Set<number> {
    const hours = new Set<number>();
    for (const window of source) {
      if (isSameDay(window.startAt, date)) {
        for (const hour of expandWindowToHours({
          startHour: window.startAt.getHours(),
          endHour: window.endAt.getHours(),
        })) {
          hours.add(hour);
        }
      }
    }
    return hours;
  }

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  function onSelectCoach(coachId: string) {
    router.push(`/dashboard/coaching/availability?coachId=${coachId}`);
  }

  function goToWeek(newWeekStart: Date) {
    const dayOffset = Math.round((selectedDate.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
    setWeekStart(newWeekStart);
    setSelectedDate(addDays(newWeekStart, dayOffset));
  }

  function goToThisWeek() {
    setWeekStart(startOfWeek(today));
    setSelectedDate(today);
  }

  // Render-only — derived from the `windows` STATE (so it correctly
  // triggers re-renders), never read by commitToggle's own logic. See
  // windowsRef's comment above for why the two must stay separate.
  const onHoursForSelectedDate = useMemo(() => hoursForDay(windows, selectedDate), [windows, selectedDate]);

  // Bounded by the facility's own configured hours for this weekday
  // (defaults 7 AM-11 PM) — never a hardcoded 7/23, same discipline as
  // every other hour bound in this app (lib/court-hours.ts).
  const gridHours = useMemo(() => {
    const [openHourStr] = courtHours.facilityOpenTime.split(":");
    const openHour = Number(openHourStr);
    const closeMinutes = getFacilityCloseMinutes(courtHours, selectedDate);
    const closeHour = Math.min(Math.floor(closeMinutes / 60), 24);
    return Array.from({ length: Math.max(0, closeHour - openHour) }, (_, index) => openHour + index);
  }, [courtHours, selectedDate]);

  function commitToggle(hour: number) {
    // Reads windowsRef, NOT the memoized onHoursForSelectedDate — the
    // ref is synchronously current even across clicks fired faster
    // than React re-renders between them; the memo is not.
    const nextHours = hoursForDay(windowsRef.current, selectedDate);
    if (nextHours.has(hour)) {
      nextHours.delete(hour);
    } else {
      nextHours.add(hour);
    }
    const sortedHours = Array.from(nextHours).sort((a, b) => a - b);

    // Optimistic: apply the same reconciliation the server does
    // (mergeHoursIntoWindows) to the ref immediately and synchronously
    // — before this function returns, let alone before any network
    // round-trip — so the very next click, however soon, reads this
    // update rather than stale data.
    const mergedForDay: WindowLike[] = mergeHoursIntoWindows(sortedHours).map((window, index) => ({
      id: `optimistic-${selectedDate.toISOString()}-${index}`,
      startAt: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), window.startHour),
      endAt: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), window.endHour),
    }));
    const newWindows = [
      ...windowsRef.current.filter((window) => !isSameDay(window.startAt, selectedDate)),
      ...mergedForDay,
    ];
    windowsRef.current = newWindows;
    setWindows(newWindows);

    scheduleSave(selectedDate, sortedHours);
  }

  function handleHourClick(hour: number) {
    const turningOff = hoursForDay(windowsRef.current, selectedDate).has(hour);
    if (turningOff) {
      const slotStart = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        hour,
      );
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
      const conflicting = activeSessions.filter(
        (session) => session.booking.startAt < slotEnd && session.booking.endAt > slotStart,
      );
      if (conflicting.length > 0) {
        setPendingClear({ hour, sessions: conflicting });
        return;
      }
    }
    commitToggle(hour);
  }

  function handleCopyLastWeek() {
    startTransition(async () => {
      const result = await copyWeekAvailabilityAction({ coachId: selectedCoachId, weekStart });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Copied last week's availability onto this week.");
      router.refresh();
    });
  }

  const cellState = (hour: number): HourCellState => (onHoursForSelectedDate.has(hour) ? "on" : "off");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="coachId">Coach</Label>
        <Select value={selectedCoachId} onValueChange={(value) => value && onSelectCoach(value)}>
          <SelectTrigger id="coachId" className="w-full max-w-sm">
            <SelectValue placeholder="Select a coach">
              {(value: string) => {
                const coach = coaches.find((c) => c.id === value);
                return coach ? (coach.user.name ?? coach.user.email) : "Select a coach";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {coaches.map((coach) => (
              <SelectItem key={coach.id} value={coach.id}>
                {coach.user.name ?? coach.user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isOwnCalendar ? (
          <p className="text-muted-foreground text-xs">
            You&apos;re editing another coach&apos;s calendar — allowed for now while the current
            coaches coordinate schedules directly (see BUILD-SPEC.md §15). Every change here is
            audit-logged with who actually made it.
          </p>
        ) : null}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => goToWeek(addDays(weekStart, -7))}>
                ← Prev week
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={goToThisWeek}>
                This week
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => goToWeek(addDays(weekStart, 7))}>
                Next week →
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleCopyLastWeek}>
              Copy last week
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map((day) => {
              const isSelected = isSameDay(day, selectedDate);
              const hasAvailability = windows.some((window) => isSameDay(window.startAt, day));
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs font-medium transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : // Reported live: bg-background is this app's dark
                        // page-navy token, but this button sits inside a
                        // white Card — text here inherits the Card's dark
                        // text-card-foreground, so unselected days were
                        // dark text on a dark background. bg-card matches
                        // the parent Card's own white background (same
                        // pairing card.tsx always uses) instead.
                        "bg-card text-card-foreground hover:bg-accent border-input",
                  )}
                >
                  <span className="uppercase tracking-wide opacity-80">{weekdayFormatter.format(day)}</span>
                  <span className="text-base font-semibold">{day.getDate()}</span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      hasAvailability ? (isSelected ? "bg-primary-foreground" : "bg-primary") : "bg-transparent",
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{dayHeadingFormatter.format(selectedDate)}</h2>
          <p className="text-muted-foreground text-xs">
            Tap an hour to mark it available; tap again to clear it. Whole hours only.
          </p>
        </div>
        {gridHours.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The facility has no operating hours configured for this day.
          </p>
        ) : (
          <HourGrid hours={gridHours} cellState={cellState} onHourClick={handleHourClick} />
        )}
      </div>

      <AlertDialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingClear(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this hour anyway?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingClear ? (
                <>
                  {pendingClear.sessions.length === 1 ? "A" : pendingClear.sessions.length} real coaching{" "}
                  {pendingClear.sessions.length === 1 ? "session falls" : "sessions fall"} in this hour:
                  <span className="mt-2 block flex-col gap-1">
                    {pendingClear.sessions.map((session) => (
                      <span key={session.id} className="text-foreground block text-sm font-medium">
                        {sessionCustomerName(session)} · {session.booking.court.name} ·{" "}
                        {personDateTimeFormatter.format(session.booking.startAt)}
                      </span>
                    ))}
                  </span>
                  <span className="mt-2 block">
                    Clearing availability will NOT cancel or change this booking — resolving a real
                    conflict means contacting the customer directly, not something this screen can do.
                  </span>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingClear(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const hour = pendingClear?.hour;
                setPendingClear(null);
                if (hour !== undefined) {
                  commitToggle(hour);
                }
              }}
            >
              Clear anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
