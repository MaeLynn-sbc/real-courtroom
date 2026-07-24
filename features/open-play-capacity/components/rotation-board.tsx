"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  cancelAssignmentAction,
  completeAssignmentAction,
  confirmAssignmentAction,
  createManualAssignmentAction,
  markDoneAction,
  markRestingAction,
  markWaitingAgainAction,
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

export function RotationBoard({ date, courts, waiting, resting, maxWaitMinutes, unfillableQueueReason }: RotationBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manualPicks, setManualPicks] = useState<string[]>([]);
  const [manualCourtId, setManualCourtId] = useState<string>(courts[0]?.id ?? "");

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
                    {court.active.source === "MANUAL" ? "Manual foursome" : `Skill spread ${court.active.skillSpread}`} · started{" "}
                    {court.active.startedAt ? new Date(court.active.startedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "—"}
                  </p>
                  <div className="flex gap-2">
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
                    {court.proposed.source === "MANUAL" ? "Manual foursome" : `Skill spread ${court.proposed.skillSpread}`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      onClick={() => runAction(confirmAssignmentAction({ assignmentId: court.proposed!.id }), "Confirmed.")}
                    >
                      Confirm
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
                    onClick={() => runAction(proposeAssignmentAction({ date, courtId: court.id }), "Foursome proposed.")}
                  >
                    Propose next foursome
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
            waiting.map((unit) => (
              <div
                key={unit.partyId ?? unit.members[0]?.queueEntryId}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2",
                  unit.pastMaxWait && "border-coral/40 bg-coral/[0.08]",
                )}
              >
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
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build a foursome by hand</CardTitle>
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
                  "Manual foursome created.",
                )
              }
            >
              Create manual foursome
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
