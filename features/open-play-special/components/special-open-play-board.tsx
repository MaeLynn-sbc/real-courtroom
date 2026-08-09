"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  announceSpecialCourtAction,
  announceSpecialCourtTimesUpAction,
  assignSpecialGroupToCourtAction,
  checkInSpecialPlayerAction,
  checkInSpecialPlayerToSlotAction,
  checkOutSpecialPlayerAction,
  clearSpecialStagedSlotAction,
  completeSpecialCourtGameAction,
  stageSpecialGroupAction,
  startSpecialCourtTimerAction,
} from "@/actions/special-open-play.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SkillLevel } from "@/lib/generated/prisma/enums";

const COURT_LABELS = ["Court 1", "Court 2", "Court 3"] as const;
const MAX_PLAYERS_PER_COURT = 4;
// Owner request (2026-08-09): "can we also add next up. then next
// then" — manual staging only (confirmed over adding the full
// auto-pairing "Auto queue" engine). A group is built by hand into one
// of these slots and later sent to whichever court frees up, instead of
// having to know the destination court up front.
const STAGED_SLOTS = ["NEXT_UP", "AFTER_THAT", "THEN"] as const;
type StagedSlot = (typeof STAGED_SLOTS)[number];
const STAGED_SLOT_LABELS: Record<StagedSlot, string> = {
  NEXT_UP: "Next up",
  AFTER_THAT: "After that",
  THEN: "Then",
};
// Owner request (2026-08-09): a 20-minute soft target, same idea as real
// Open Play's targetGameMinutes countdown — purely informational, nothing
// auto-happens at zero, recomputed at render (no client-side ticking
// clock), same as the real rotation board's own staff-screen timer.
const GAME_TARGET_MINUTES = 20;
// Owner request (2026-08-09): "dont auto start the time. create a
// button for it but after 3 minutes when the button is not clicked.
// make it on auto start." Must match
// special-open-play-tv-client.tsx's own copy of this constant.
const TIMER_AUTO_START_GRACE_MINUTES = 3;

const SKILL_LABELS: Record<SkillLevel, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  PRO: "Pro",
};

export interface SpecialCheckIn {
  id: string;
  playerName: string;
  phone: string | null;
  skillLevel: SkillLevel | null;
  status: "WAITING" | "PLAYING" | "DONE";
  courtLabel: string | null;
  startedAt: string | null;
  timerStartedAt: string | null;
  stagedSlot: StagedSlot | null;
}

function formatStartedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Owner request (2026-08-09): "dont auto start the time. create a
// button for it but after 3 minutes when the button is not clicked.
// make it on auto start" — resolves the timer's real start moment:
// timerStartedAt if staff pressed Start, else startedAt+3min once that
// grace period has elapsed with no button press, else null (still
// within the grace window). Same logic as
// special-open-play-tv-client.tsx's own copy.
function getEffectiveTimerStart(
  startedAt: string | null,
  timerStartedAt: string | null,
  now: number,
): string | null {
  if (timerStartedAt) return timerStartedAt;
  if (!startedAt) return null;
  const autoStartAtMs = new Date(startedAt).getTime() + TIMER_AUTO_START_GRACE_MINUTES * 60_000;
  return now >= autoStartAtMs ? new Date(autoStartAtMs).toISOString() : null;
}

// Owner request (2026-08-09): "i want it to appear like minute with
// seconds. like 03.04" — MM:SS instead of a rounded "Xm left".
function formatGameTimeRemaining(timerStartIso: string, now: number): { text: string; overtime: boolean } {
  const endAtMs = new Date(timerStartIso).getTime() + GAME_TARGET_MINUTES * 60_000;
  const msLeft = endAtMs - now;
  const totalSeconds = Math.floor(Math.abs(msLeft) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { text: msLeft <= 0 ? `${mmss} over` : mmss, overtime: msLeft <= 0 };
}

// Owner request (2026-08-09): "an outside special court... like i can
// form a group and put it to court a." Check-in + manual GROUP court
// assignment (up to 4 at once), a manual Announce button per court
// (watched by the isolated /specialtv display), no auto-pairing, no
// Sale, no PlayerTab, no connection to the real Open Play system.
export function SpecialOpenPlayBoard({
  dateValue,
  checkIns,
}: {
  dateValue: string;
  checkIns: SpecialCheckIn[];
}) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [buildTarget, setBuildTarget] = useState<string>(COURT_LABELS[0]);
  // Owner request (2026-08-09): "can i manually add player" (in every
  // staging box) — a quick-add name field right in each Next up/After
  // that/Then card, one per slot.
  const [quickAddNames, setQuickAddNames] = useState<Record<StagedSlot, string>>({
    NEXT_UP: "",
    AFTER_THAT: "",
    THEN: "",
  });
  // Owner request (2026-08-09): "the add player option should have
  // searchable option from the waiting list" — typing filters the
  // existing Waiting list; picking a result stages that player directly
  // instead of creating a duplicate check-in. Only one slot's dropdown
  // is open at a time.
  const [quickAddOpenSlot, setQuickAddOpenSlot] = useState<StagedSlot | null>(null);
  const [isPending, startTransition] = useTransition();
  // Live MM:SS display for the game timer — ticks every second on the
  // client only; nothing server-side polls or refreshes from this.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Owner request (2026-08-09): "make sure it updates every 10 seconds.
  // the page and the /tourtv as well" — this admin board only refreshed
  // on the current user's own actions before; now it also polls the
  // server every 10s, same interval /tourtv already uses (see
  // settingsService.getDisplayRefreshIntervalSeconds, default 10s), so
  // check-ins/assignments made from another device show up here too.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router]);

  const waiting = checkIns.filter((c) => c.status === "WAITING" && c.stagedSlot === null);
  const playingByCourt = new Map<string, SpecialCheckIn[]>();
  const stagedBySlot = new Map<StagedSlot, SpecialCheckIn[]>();
  for (const checkIn of checkIns) {
    if (checkIn.status === "PLAYING" && checkIn.courtLabel) {
      const existing = playingByCourt.get(checkIn.courtLabel);
      if (existing) {
        existing.push(checkIn);
      } else {
        playingByCourt.set(checkIn.courtLabel, [checkIn]);
      }
    }
    if (checkIn.status === "WAITING" && checkIn.stagedSlot) {
      const existing = stagedBySlot.get(checkIn.stagedSlot);
      if (existing) {
        existing.push(checkIn);
      } else {
        stagedBySlot.set(checkIn.stagedSlot, [checkIn]);
      }
    }
  }
  const isCourtTarget = (value: string): value is (typeof COURT_LABELS)[number] =>
    (COURT_LABELS as readonly string[]).includes(value);

  function refresh() {
    router.refresh();
  }

  function toggleSelected(checkInId: string) {
    setSelectedIds((current) =>
      current.includes(checkInId) ? current.filter((id) => id !== checkInId) : [...current, checkInId],
    );
  }

  function handleCheckIn() {
    if (!playerName.trim()) {
      toast.error("Enter a name.");
      return;
    }
    startTransition(async () => {
      const result = await checkInSpecialPlayerAction({
        date: dateValue,
        playerName: playerName.trim(),
        phone: phone.trim() || undefined,
        skillLevel: skillLevel || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName.trim()} checked in.`);
      setPlayerName("");
      setPhone("");
      setSkillLevel("");
      refresh();
    });
  }

  function handleAssignGroup(courtLabel: string) {
    if (selectedIds.length === 0) {
      toast.error("Select at least one player first.");
      return;
    }
    startTransition(async () => {
      const result = await assignSpecialGroupToCourtAction({ checkInIds: selectedIds, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${selectedIds.length} player(s) assigned to ${courtLabel}.`);
      setSelectedIds([]);
      refresh();
    });
  }

  function handleStageGroup(slot: StagedSlot) {
    if (selectedIds.length === 0) {
      toast.error("Select at least one player first.");
      return;
    }
    startTransition(async () => {
      const result = await stageSpecialGroupAction({ checkInIds: selectedIds, slot });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${selectedIds.length} player(s) staged in ${STAGED_SLOT_LABELS[slot]}.`);
      setSelectedIds([]);
      refresh();
    });
  }

  function handleCreateGroup() {
    if (isCourtTarget(buildTarget)) {
      handleAssignGroup(buildTarget);
    } else {
      handleStageGroup(buildTarget as StagedSlot);
    }
  }

  function handleClearStagedSlot(slot: StagedSlot) {
    startTransition(async () => {
      const result = await clearSpecialStagedSlotAction({ date: dateValue, slot });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${STAGED_SLOT_LABELS[slot]} cleared — back to Waiting.`);
      refresh();
    });
  }

  function handleQuickAddToSlot(slot: StagedSlot) {
    const name = quickAddNames[slot].trim();
    if (!name) {
      toast.error("Enter a name.");
      return;
    }
    startTransition(async () => {
      const result = await checkInSpecialPlayerToSlotAction({ date: dateValue, playerName: name, slot });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} added to ${STAGED_SLOT_LABELS[slot]}.`);
      setQuickAddNames((current) => ({ ...current, [slot]: "" }));
      setQuickAddOpenSlot(null);
      refresh();
    });
  }

  // Staging an EXISTING waiting player found via search, instead of
  // checking in a duplicate.
  function handleQuickAddExisting(checkInId: string, playerName: string, slot: StagedSlot) {
    startTransition(async () => {
      const result = await stageSpecialGroupAction({ checkInIds: [checkInId], slot });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName} added to ${STAGED_SLOT_LABELS[slot]}.`);
      setQuickAddNames((current) => ({ ...current, [slot]: "" }));
      setQuickAddOpenSlot(null);
      refresh();
    });
  }

  function handleSendStagedToCourt(slot: StagedSlot, courtLabel: string) {
    const group = stagedBySlot.get(slot) ?? [];
    if (group.length === 0) return;
    startTransition(async () => {
      const result = await assignSpecialGroupToCourtAction({
        checkInIds: group.map((c) => c.id),
        courtLabel,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${STAGED_SLOT_LABELS[slot]} sent to ${courtLabel}.`);
      refresh();
    });
  }

  function handleCompleteGame(courtLabel: string) {
    startTransition(async () => {
      const result = await completeSpecialCourtGameAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${courtLabel} game marked done — back to Waiting.`);
      refresh();
    });
  }

  function handleStartTimer(courtLabel: string) {
    startTransition(async () => {
      const result = await startSpecialCourtTimerAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Timer started for ${courtLabel}.`);
      refresh();
    });
  }

  function handleAnnounce(courtLabel: string) {
    startTransition(async () => {
      const result = await announceSpecialCourtAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Announced ${courtLabel}.`);
      refresh();
    });
  }

  function handleTimesUp(courtLabel: string) {
    startTransition(async () => {
      const result = await announceSpecialCourtTimesUpAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Time's up announced for ${courtLabel}.`);
      refresh();
    });
  }

  function handleCheckOut(checkInId: string) {
    startTransition(async () => {
      const result = await checkOutSpecialPlayerAction({ checkInId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked out.");
      setSelectedIds((current) => current.filter((id) => id !== checkInId));
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Special Open Play</h1>
        <p className="text-muted-foreground text-sm">
          Private, temporary board for the outside special court. No fees, no Sale — check in, select a
          group, assign to a court, mark done.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check in a player</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerName">Name</Label>
            <Input
              id="specialPlayerName"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerPhone">Phone (optional)</Label>
            <Input
              id="specialPlayerPhone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerSkill">Skill (optional)</Label>
            <Select
              value={skillLevel}
              onValueChange={(value) => setSkillLevel((value as SkillLevel) ?? "")}
            >
              <SelectTrigger id="specialPlayerSkill" className="w-full">
                <SelectValue>{() => (skillLevel ? SKILL_LABELS[skillLevel] : "Select")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SKILL_LABELS) as SkillLevel[]).map((level) => (
                  <SelectItem key={level} value={level}>
                    {SKILL_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={isPending} onClick={handleCheckIn} className="w-full">
              Check in
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COURT_LABELS.map((courtLabel) => {
          const occupants = playingByCourt.get(courtLabel) ?? [];
          const earliestStart = occupants
            .map((o) => o.startedAt)
            .filter((value): value is string => value !== null)
            .sort()[0];
          const earliestTimerStart = occupants
            .map((o) => o.timerStartedAt)
            .filter((value): value is string => value !== null)
            .sort()[0];
          const effectiveTimerStart = earliestStart
            ? getEffectiveTimerStart(earliestStart, earliestTimerStart ?? null, now)
            : null;
          return (
            <Card key={courtLabel}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{courtLabel}</span>
                  {occupants.length > 0 ? <Badge>On court</Badge> : <Badge variant="outline">Empty</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {occupants.length > 0 ? (
                  <>
                    <ul className="flex flex-col gap-1">
                      {occupants.map((occupant) => (
                        <li key={occupant.id} className="text-sm">
                          {occupant.playerName}
                          {occupant.skillLevel ? (
                            <span className="text-muted-foreground ml-1 text-xs">
                              · {SKILL_LABELS[occupant.skillLevel]}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {earliestStart ? (
                      <p className="text-muted-foreground text-xs">
                        Manual group · started {formatStartedAt(earliestStart)}
                      </p>
                    ) : null}
                    {effectiveTimerStart ? (
                      <Badge
                        variant={formatGameTimeRemaining(effectiveTimerStart, now).overtime ? "warning" : "outline"}
                        className="w-fit"
                      >
                        {formatGameTimeRemaining(effectiveTimerStart, now).text}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        disabled={isPending}
                        onClick={() => handleStartTimer(courtLabel)}
                      >
                        Start timer
                      </Button>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleAnnounce(courtLabel)}
                      >
                        Announce
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleTimesUp(courtLabel)}
                      >
                        Time&apos;s up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleCompleteGame(courtLabel)}
                      >
                        Complete game
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Empty</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build a group by hand</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Pick 1 to 4 players from the waiting list below (checkboxes), choose a court or a staging slot,
            then create the group.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={buildTarget} onValueChange={(value) => setBuildTarget(value ?? COURT_LABELS[0])}>
              <SelectTrigger className="w-48">
                <SelectValue>
                  {() => (isCourtTarget(buildTarget) ? buildTarget : STAGED_SLOT_LABELS[buildTarget as StagedSlot])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COURT_LABELS.map((courtLabel) => {
                  const occupants = playingByCourt.get(courtLabel) ?? [];
                  const remaining = MAX_PLAYERS_PER_COURT - occupants.length;
                  return (
                    <SelectItem key={courtLabel} value={courtLabel} disabled={remaining === 0}>
                      {courtLabel} ({remaining} open)
                    </SelectItem>
                  );
                })}
                {STAGED_SLOTS.map((slot) => {
                  const staged = stagedBySlot.get(slot) ?? [];
                  const remaining = MAX_PLAYERS_PER_COURT - staged.length;
                  return (
                    <SelectItem key={slot} value={slot} disabled={remaining === 0}>
                      {STAGED_SLOT_LABELS[slot]} ({remaining} open)
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-sm">
              {selectedIds.length}/{MAX_PLAYERS_PER_COURT} picked
            </span>
            <Button
              type="button"
              disabled={
                isPending ||
                selectedIds.length === 0 ||
                (isCourtTarget(buildTarget)
                  ? selectedIds.length > MAX_PLAYERS_PER_COURT - (playingByCourt.get(buildTarget)?.length ?? 0)
                  : selectedIds.length >
                    MAX_PLAYERS_PER_COURT - (stagedBySlot.get(buildTarget as StagedSlot)?.length ?? 0))
              }
              onClick={handleCreateGroup}
            >
              Create group
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STAGED_SLOTS.map((slot) => {
          const group = stagedBySlot.get(slot) ?? [];
          const slotFull = group.length >= MAX_PLAYERS_PER_COURT;
          return (
            <Card key={slot}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{STAGED_SLOT_LABELS[slot]}</span>
                  {group.length > 0 ? <Badge variant="outline">{group.length}/4 staged</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {group.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {group.map((member) => (
                      <li key={member.id} className="text-sm">
                        {member.playerName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">Empty.</p>
                )}

                <div className="flex gap-2 pt-1">
                  <div className="relative flex-1">
                    <Input
                      placeholder="Add player…"
                      value={quickAddNames[slot]}
                      onChange={(event) => {
                        setQuickAddNames((current) => ({ ...current, [slot]: event.target.value }));
                        setQuickAddOpenSlot(slot);
                      }}
                      onFocus={() => setQuickAddOpenSlot(slot)}
                      onBlur={() =>
                        setQuickAddOpenSlot((current) => (current === slot ? null : current))
                      }
                      disabled={isPending || slotFull}
                      className="h-8 text-sm"
                    />
                    {quickAddOpenSlot === slot && quickAddNames[slot].trim()
                      ? (() => {
                          const query = quickAddNames[slot].trim().toLowerCase();
                          const matches = waiting.filter((w) => w.playerName.toLowerCase().includes(query));
                          if (matches.length === 0) return null;
                          return (
                            <ul className="bg-popover absolute z-10 mt-1 w-full rounded-md border shadow-md">
                              {matches.slice(0, 6).map((match) => (
                                <li key={match.id}>
                                  <button
                                    type="button"
                                    className="hover:bg-accent w-full px-2 py-1.5 text-left text-sm"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      handleQuickAddExisting(match.id, match.playerName, slot);
                                    }}
                                  >
                                    {match.playerName}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          );
                        })()
                      : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || slotFull}
                    onClick={() => handleQuickAddToSlot(slot)}
                  >
                    Add
                  </Button>
                </div>

                {group.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {COURT_LABELS.map((courtLabel) => {
                      const occupants = playingByCourt.get(courtLabel) ?? [];
                      const remaining = MAX_PLAYERS_PER_COURT - occupants.length;
                      return (
                        <Button
                          key={courtLabel}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending || remaining < group.length}
                          onClick={() => handleSendStagedToCourt(slot, courtLabel)}
                        >
                          → {courtLabel}
                        </Button>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleClearStagedSlot(slot)}
                    >
                      Clear
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Waiting ({waiting.length})
            {selectedIds.length > 0 ? (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {selectedIds.length} selected
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody waiting.</p>
          ) : (
            waiting.map((checkIn) => (
              <div
                key={checkIn.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(checkIn.id)}
                    onChange={() => toggleSelected(checkIn.id)}
                    disabled={isPending}
                    className="border-input checked:border-court-blue checked:bg-court-blue size-3.5 shrink-0 cursor-pointer appearance-none rounded border bg-white"
                  />
                  <span className="font-medium">{checkIn.playerName}</span>
                  {checkIn.skillLevel ? (
                    <span className="text-muted-foreground text-xs">{SKILL_LABELS[checkIn.skillLevel]}</span>
                  ) : null}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleCheckOut(checkIn.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
