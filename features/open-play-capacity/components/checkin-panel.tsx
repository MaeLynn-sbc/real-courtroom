"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { checkInAction, undoCheckInAction } from "@/actions/open-play-checkin.actions";
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
}: {
  expected: CheckInRegistration[];
  checkedIn: CheckInRegistration[];
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
                <button
                  key={registration.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleCheckIn(registration.id, registration.playerName)}
                  className="hover:border-primary flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors"
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
