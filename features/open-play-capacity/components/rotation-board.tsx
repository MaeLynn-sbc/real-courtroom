"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  announceAssignmentAction,
  cancelAssignmentAction,
  completeAssignmentAction,
  confirmAssignmentAction,
  createManualAssignmentAction,
  markDoneAction,
  markRestingAction,
  markWaitingAgainAction,
  moveQueueUnitAfterAction,
  proposeAssignmentAction,
  type OpenPlayRotationActionState,
} from "@/actions/open-play-rotation.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

interface BoardMember {
  queueEntryId: string;
  registrationId: string;
  playerName: string;
  skillLevel: OpenPlaySkillLevel;
}

interface BoardUnit {
  partyId: string | null;
  members: BoardMember[];
  waitMinutes: number;
  pastMaxWait: boolean;
}

interface BoardAssignment {
  id: string;
  source: "AUTO" | "MANUAL";
  status: "PROPOSED" | "ACTIVE" | "DONE" | "CANCELLED";
  skillSpread: number;
  startedAt: string | null;
  // Manual timer/announce: null until ANNOUNCE has been pressed at least
  // once. Re-pressable — a fresh value each time, which is also what the
  // TV/phone displays watch to decide when to (re-)speak.
  announcementRequestedAt: string | null;
  // True once a PROPOSED assignment has sat unstarted past the owner's
  // forgottenAssignmentNudgeMinutes setting — computed server-side at
  // page render (see app/dashboard/admin/open-play-capacity/[date]/
  // page.tsx's serializeAssignment), always false for a non-PROPOSED one.
  waitingToStart: boolean;
  participants: { registrationId: string; playerName: string; skillLevel: OpenPlaySkillLevel }[];
}

interface BoardCourt {
  id: string;
  name: string;
  active: BoardAssignment | null;
  proposed: BoardAssignment | null;
}

interface BoardRestingPlayer {
  queueEntryId: string;
  playerName: string;
  skillLevel: OpenPlaySkillLevel;
}

export interface RotationBoardProps {
  date: string; // YYYY-MM-DD
  courts: BoardCourt[];
  waiting: BoardUnit[];
  resting: BoardRestingPlayer[];
  maxWaitMinutes: number;
  unfillableQueueReason: string | null;
}

function skillLabel(level: OpenPlaySkillLevel): string {
  return OPEN_PLAY_SKILL_LEVELS[level].label;
}

// Queue reorder: a unit (solo or party) is keyed and labeled the same way
// throughout — partyId when there is one, else the sole member's
// queueEntryId, matching the existing key= on the waiting-list row below.
function unitKey(unit: BoardUnit): string {
  return unit.partyId ?? unit.members[0]?.queueEntryId ?? "";
}

function unitLabel(unit: BoardUnit): string {
  return unit.members.map((member) => member.playerName).join(" & ");
}

export function RotationBoard({ date, courts, waiting, resting, maxWaitMinutes, unfillableQueueReason }: RotationBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manualPicks, setManualPicks] = useState<string[]>([]);
  const [manualCourtId, setManualCourtId] = useState<string>(courts[0]?.id ?? "");
  // Queue reorder: which unit each OTHER unit is currently set to move
  // after, keyed by the mover's own unitKey — a plain <select>, not
  // drag-and-drop (a busy front-desk laptop, per the ask).
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});

  function refresh() {
    router.refresh();
  }

  function runAction(promise: Promise<OpenPlayRotationActionState>, successMessage: string) {
    startTransition(async () => {
      const result = await promise;
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      refresh();
    });
  }

  function toggleManualPick(registrationId: string) {
    setManualPicks((prev) =>
      prev.includes(registrationId) ? prev.filter((id) => id !== registrationId) : [...prev, registrationId],
    );
  }

  // Quick-queue: strict FIFO, no skill matching, no manual picking —
  // `waiting` is already in wait order (longest-waiting unit first, per
  // getRotationBoardData), so flattening each unit's members in place and
  // taking the first 4 IS "the first 4 people in wait order." Reuses
  // createManualAssignment via createManualAssignmentAction below — a
  // different SELECTION rule only, not a second group-creation mechanism.
  // Strict, as asked: a party that doesn't fit evenly into the next 4-slot
  // boundary can be split by this cut (e.g. two parties of 3 back to
  // back) — createManualAssignment has no party-wholeness check to
  // violate, but this is a real, known consequence of "strict FIFO."
  const flatWaitingIds = waiting.flatMap((unit) => unit.members.map((member) => member.registrationId));
  const quickQueueIds = flatWaitingIds.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      {unfillableQueueReason ? (
        <div className="border-coral/40 bg-coral/[0.08] text-coral flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium">
          <span aria-hidden="true">⚠</span>
          <span>
            Queue can&apos;t be filled right now — {unfillableQueueReason}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {courts.map((court) => (
          <Card key={court.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {court.name}
                {court.active ? <Badge>On court</Badge> : court.proposed ? <Badge variant="outline">Proposed</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {court.active ? (
                <>
                  <ul className="text-sm">
                    {court.active.participants.map((p) => (
                      <li key={p.registrationId}>
                        {p.playerName} · {skillLabel(p.skillLevel)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {court.active.source === "MANUAL" ? "Manual group" : `Skill spread ${court.active.skillSpread}`} · started{" "}
                    {court.active.startedAt ? new Date(court.active.startedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "—"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        runAction(announceAssignmentAction({ assignmentId: court.active!.id }), "Announced.")
                      }
                    >
                      Announce
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      onClick={() => runAction(completeAssignmentAction({ assignmentId: court.active!.id }), "Game complete.")}
                    >
                      Complete game
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => runAction(cancelAssignmentAction({ assignmentId: court.active!.id }), "Game cancelled.")}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : court.proposed ? (
                <>
                  <ul className="text-sm">
                    {court.proposed.participants.map((p) => (
                      <li key={p.registrationId}>
                        {p.playerName} · {skillLabel(p.skillLevel)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {court.proposed.source === "MANUAL" ? "Manual group" : `Skill spread ${court.proposed.skillSpread}`}
                  </p>
                  {/* Manual timer/announce, forgotten-assignment nudge: same
                      "past a configurable minutes threshold" treatment as
                      the waiting list's own pastMaxWait warning below. */}
                  {court.proposed.waitingToStart ? (
                    <p className="text-warning-foreground bg-warning/15 rounded-lg px-2 py-1.5 text-xs font-medium">
                      Waiting to start — Start Timer hasn&apos;t been pressed yet.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        runAction(announceAssignmentAction({ assignmentId: court.proposed!.id }), "Announced.")
                      }
                    >
                      Announce
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      onClick={() => runAction(confirmAssignmentAction({ assignmentId: court.proposed!.id }), "Timer started.")}
                    >
                      Start timer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => runAction(cancelAssignmentAction({ assignmentId: court.proposed!.id }), "Proposal discarded.")}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">Idle.</p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => runAction(proposeAssignmentAction({ date, courtId: court.id }), "Group proposed.")}
                  >
                    Propose next group
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending || quickQueueIds.length < 4}
                    onClick={() =>
                      runAction(
                        createManualAssignmentAction({ date, courtId: court.id, registrationIds: quickQueueIds }),
                        "Group created.",
                      )
                    }
                  >
                    Quick-queue
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Waiting ({waiting.reduce((n, u) => n + u.members.length, 0)})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody waiting.</p>
          ) : (
            waiting.map((unit) => {
              const thisKey = unitKey(unit);
              const otherUnits = waiting.filter((other) => unitKey(other) !== thisKey);
              const moveTarget = moveTargets[thisKey] ?? "";
              return (
                <div
                  key={thisKey}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border px-3 py-2",
                    unit.pastMaxWait && "border-coral/40 bg-coral/[0.08]",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {unit.members.map((member) => (
                        <label key={member.registrationId} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={manualPicks.includes(member.registrationId)}
                            onChange={() => toggleManualPick(member.registrationId)}
                          />
                          {member.playerName} <span className="text-muted-foreground text-xs">({skillLabel(member.skillLevel)})</span>
                        </label>
                      ))}
                      {unit.partyId ? <Badge variant="outline">party</Badge> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs", unit.pastMaxWait ? "text-coral font-semibold" : "text-muted-foreground")}>
                        waiting {unit.waitMinutes}m{unit.pastMaxWait ? ` (past ${maxWaitMinutes}m)` : ""}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() =>
                          runAction(markRestingAction({ queueEntryId: unit.members[0].queueEntryId }), "Marked resting.")
                        }
                      >
                        Rest
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => runAction(markDoneAction({ queueEntryId: unit.members[0].queueEntryId }), "Marked done.")}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                  {/* Queue reorder (reported live): a forming group short a
                      player wants a specific, later-queued player — staff
                      move THIS unit to sit right after whoever's picked
                      below. Everyone between here and there advances
                      automatically; nothing else to click. */}
                  {otherUnits.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                      <span className="text-muted-foreground text-xs">Move after</span>
                      <select
                        className="border-input rounded-md border px-2 py-1 text-xs"
                        value={moveTarget}
                        onChange={(event) =>
                          setMoveTargets((prev) => ({ ...prev, [thisKey]: event.target.value }))
                        }
                      >
                        <option value="">Choose a player…</option>
                        {otherUnits.map((other) => (
                          <option key={unitKey(other)} value={other.members[0].registrationId}>
                            {unitLabel(other)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending || !moveTarget}
                        onClick={() =>
                          runAction(
                            moveQueueUnitAfterAction({
                              date,
                              movingRegistrationIds: unit.members.map((member) => member.registrationId),
                              targetRegistrationId: moveTarget,
                            }).then((r) => {
                              if (!r.error) setMoveTargets((prev) => ({ ...prev, [thisKey]: "" }));
                              return r;
                            }),
                            "Moved.",
                          )
                        }
                      >
                        Move
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build a group by hand</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Pick 4 from the waiting list above (checkboxes), choose a court, then create — skill is ignored
            entirely. Discards any pending auto-proposal on that court.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border-input rounded-md border px-2 py-1.5 text-sm"
              value={manualCourtId}
              onChange={(event) => setManualCourtId(event.target.value)}
            >
              {courts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">{manualPicks.length}/4 picked</span>
            <Button
              type="button"
              size="sm"
              disabled={isPending || manualPicks.length !== 4 || !manualCourtId}
              onClick={() =>
                runAction(
                  createManualAssignmentAction({ date, courtId: manualCourtId, registrationIds: manualPicks }).then((r) => {
                    if (!r.error) setManualPicks([]);
                    return r;
                  }),
                  "Group created.",
                )
              }
            >
              Create group
            </Button>
          </div>
        </CardContent>
      </Card>

      {resting.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Resting ({resting.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {resting.map((player) => (
              <div key={player.queueEntryId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <span className="text-sm">
                  {player.playerName} <span className="text-muted-foreground text-xs">({skillLabel(player.skillLevel)})</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    runAction(markWaitingAgainAction({ queueEntryId: player.queueEntryId }), "Back in the queue.")
                  }
                >
                  Back to waiting
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
