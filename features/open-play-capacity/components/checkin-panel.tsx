"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { checkInAction, undoCheckInAction } from "@/actions/open-play-checkin.actions";
import { markNoShowAction } from "@/actions/open-play-registration.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

interface CheckInRegistration {
  id: string;
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  partyId: string | null;
  checkedInAt: string | null; // ISO string — serialized from the server
}

const UNDO_WINDOW_MS = 60_000;

function timeFormat(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

export function CheckInPanel({
  expected,
  checkedIn,
  // Fri/Sat only — weeknight has no capacity/waitlist, so "releasing a
  // seat" is meaningless there (see the [date]/page.tsx branch this is
  // called from). Owner decision (Fri/Sat waitlist rework): no
  // automatic no-show release anymore — this button is now the only way
  // a not-yet-arrived registration's seat gets freed, other than the
  // roster panel's own equivalent "No-show" action.
  isCapacityNight = false,
}: {
  expected: CheckInRegistration[];
  checkedIn: CheckInRegistration[];
  isCapacityNight?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredExpected = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expected;
    return expected.filter(
      (registration) => registration.playerName.toLowerCase().includes(q) || registration.phone.includes(q),
    );
  }, [expected, query]);

  function handleCheckIn(registrationId: string, playerName: string) {
    startTransition(async () => {
      const result = await checkInAction({ registrationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName} checked in.`);
      router.refresh();
    });
  }

  function handleUndo(registrationId: string, playerName: string) {
    startTransition(async () => {
      const result = await undoCheckInAction({ registrationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName}'s check-in undone.`);
      router.refresh();
    });
  }

  // Same releaseRegistration path markNoShow always ran through — the
  // walk-in waiting roster keeps first claim on the freed seat exactly
  // as it does for an automatic no-show, since this calls the identical
  // service method, just staff-triggered instead of reconcileNoShows.
  // No refund — the owner's non-refundable policy on release is
  // unchanged (releaseRegistration never auto-refunds).
  function handleRelease(registrationId: string, playerName: string) {
    startTransition(async () => {
      const result = await markNoShowAction({ registrationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName}'s seat released — no refund.`);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Expected ({filteredExpected.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="Search name or phone…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {filteredExpected.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody waiting to check in.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredExpected.map((registration) => (
                <div
                  key={registration.id}
                  className="hover:border-primary flex items-center justify-between gap-3 rounded-lg border px-3 py-3 transition-colors"
                >
                  {/* Reported live: "Tap to check in" was a separate Badge
                      sitting OUTSIDE the actual clickable button — only the
                      name/phone text to its left was wired to handleCheckIn.
                      Tapping exactly where it said to tap did nothing. Now
                      the badge is inside the same button, so the whole row
                      (except the separate Release seat action) is one
                      tappable target. */}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleCheckIn(registration.id, registration.playerName)}
                    className="flex flex-1 items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <p className="font-medium">{registration.playerName}</p>
                      <p className="text-muted-foreground text-xs">
                        {registration.phone} · {OPEN_PLAY_SKILL_LEVELS[registration.skillLevel].label}
                        {registration.partyId ? " · party" : ""}
                      </p>
                    </div>
                    <Badge variant="outline">Tap to check in</Badge>
                  </button>
                  {isCapacityNight ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleRelease(registration.id, registration.playerName)}
                      title="Release this seat — no refund. The walk-in waiting roster gets first claim."
                    >
                      Release seat
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checked in ({checkedIn.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {checkedIn.length === 0 ? (
            <p className="text-muted-foreground text-sm">No arrivals yet.</p>
          ) : (
            checkedIn.map((registration) => {
              const canUndo =
                registration.checkedInAt !== null &&
                Date.now() - new Date(registration.checkedInAt).getTime() < UNDO_WINDOW_MS;
              return (
                <div
                  key={registration.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
                >
                  <div>
                    <p className="font-medium">{registration.playerName}</p>
                    <p className="text-muted-foreground text-xs">
                      Arrived {registration.checkedInAt ? timeFormat(registration.checkedInAt) : "—"} ·{" "}
                      {OPEN_PLAY_SKILL_LEVELS[registration.skillLevel].label}
                    </p>
                  </div>
                  {canUndo ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleUndo(registration.id, registration.playerName)}
                    >
                      Undo
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
