"use client";

import { ArrowLeftRight, Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  announceAssignmentAction,
  announceTimesUpAction,
  assignPendingGroupToCourtAction,
  cancelAssignmentAction,
  completeAssignmentAction,
  confirmAssignmentAction,
  createManualAssignmentAction,
  markDoneAction,
  markRestingAction,
  markWaitingAgainAction,
  moveQueueUnitAfterAction,
  proposeAssignmentAction,
  swapPartyMemberAction,
  type OpenPlayRotationActionState,
} from "@/actions/open-play-rotation.actions";
import {
  cancelRegistrationAction,
  type OpenPlayRegistrationActionState,
} from "@/actions/open-play-registration.actions";
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
  // Reported live: staff could see elapsed time ("started 7:32 PM") but
  // had to look at the TV to see how much is left — same targetGameMinutes
  // soft target the TV's own countdown uses (page.tsx's serializeAssignment
  // mirrors display.service.ts's identical computation). Null unless the
  // game is ACTIVE with a real startedAt.
  endAt: string | null;
  // Manual timer/announce: null until ANNOUNCE has been pressed at least
  // once. Re-pressable — a fresh value each time, which is also what the
  // TV/phone displays watch to decide when to (re-)speak.
  announcementRequestedAt: string | null;
  // Manual "Time's up" call — same shape as announcementRequestedAt,
  // for calling players off the court. Only ever set on an ACTIVE
  // assignment (see the button's own guard below).
  timesUpRequestedAt: string | null;
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

// Reported live: "Marc ." / "Paul ." — names with no surname on file were
// rendering with a trailing separator and nothing after it. playerName is
// raw free text (no first/last split anywhere in the schema — see
// OpenPlayNightRegistration/QueueEntry), so this can only be a stray
// trailing " ." someone typed (a habit picked up from the TV display's own
// "First L." shortening, see display.service.ts's shortDisplayName).
// Stripped at render time here rather than "fixed" in stored data, since
// there's no reliable way to tell a genuine one-letter surname ("Paul C.")
// from this artifact — only a BARE trailing " ." with nothing after it is
// unambiguous.
function displayPlayerName(name: string): string {
  return name.replace(/\s+\.$/, "").trim();
}

// Queue reorder: a unit (solo or party) is keyed and labeled the same way
// throughout — partyId when there is one, else the sole member's
// queueEntryId, matching the existing key= on the waiting-list row below.
function unitKey(unit: BoardUnit): string {
  return unit.partyId ?? unit.members[0]?.queueEntryId ?? "";
}

function unitLabel(unit: BoardUnit): string {
  return unit.members.map((member) => displayPlayerName(member.playerName)).join(" & ");
}

// "Is there any way to see how much time is left on a running game from
// this screen?" — same targetGameMinutes soft target the TV display
// counts down to, just rendered here too so staff don't have to look up
// at the TV for it. Recomputed on every render, same as the rest of this
// staff screen (no client-side ticking clock) — accurate as of the last
// action or the tab wrapper's own auto-poll.
function formatGameTimeRemaining(endAt: string | null): { text: string; overtime: boolean } | null {
  if (!endAt) return null;
  const msLeft = new Date(endAt).getTime() - Date.now();
  const minutes = Math.round(Math.abs(msLeft) / 60_000);
  if (msLeft <= 0) {
    return { text: minutes === 0 ? "time's up" : `${minutes}m over`, overtime: true };
  }
  return { text: `${minutes}m left`, overtime: false };
}

// "any option to edit next up?" — a compact, TV-display-style preview
// (same "Next up" / "After that" grouping as features/display's kiosk
// board, flattened members in queue order — see display.service.ts) sitting
// right under the court cards, distinct from the detailed "Waiting" card
// below it. Each chip gets its own Cancel (existing cancelRegistrationAction)
// and Swap. No Edit here — reported live: "that's not the place for
// editing names," pulled after shipping (name/phone corrections belong
// wherever the registration itself is managed, not this preview).
type PendingGroupKey = "nextUp" | "afterThat" | "then";

function NextUpSection({
  date,
  flatMembers,
  courts,
  runAction,
  isPending,
}: {
  date: string;
  flatMembers: BoardMember[];
  courts: BoardCourt[];
  runAction: (promise: Promise<OpenPlayRegistrationActionState>, successMessage: string) => void;
  isPending: boolean;
}) {
  // Group swap ("build the group swap same as tv display"): pick exactly
  // two players from the preview (either box, doesn't matter which) and
  // swap which group each is in. A plain toggle-select of up to 2
  // registrationIds — same interaction shape as the Waiting card's
  // existing manual-pick checkboxes, just capped at 2 instead of 4.
  const [swapPicks, setSwapPicks] = useState<string[]>([]);

  // Court assignment control ("put the action where the group is"): one
  // court pick per pending group, keyed by group so Next up/After that/
  // Then don't share a single selection. Recomputed from `courts` every
  // render (a prop, driven by the page's own 10-second poll via
  // OpenPlaySessionTabs) — never cached in state, so a court freeing up
  // or filling mid-session shows up here without any extra wiring.
  const [assignCourtPicks, setAssignCourtPicks] = useState<Record<PendingGroupKey, string>>({
    nextUp: "",
    afterThat: "",
    then: "",
  });
  const vacantCourts = courts.filter((court) => !court.active && !court.proposed);

  function assignGroup(groupKey: PendingGroupKey, members: BoardMember[]) {
    const courtId = assignCourtPicks[groupKey];
    if (!courtId || members.length < 2) return;
    runAction(
      assignPendingGroupToCourtAction({
        date,
        courtId,
        registrationIds: members.map((member) => member.registrationId),
      }).then((r) => {
        if (!r.error) setAssignCourtPicks((prev) => ({ ...prev, [groupKey]: "" }));
        return r;
      }),
      "Group assigned to court.",
    );
  }

  const nextUp = flatMembers.slice(0, 4);
  const afterThat = flatMembers.slice(4, 8);
  // Third grouped preview — same "Next up / After that / Then" set the
  // TV display and /phone now both show, kept consistent across all
  // three screens.
  const then = flatMembers.slice(8, 12);

  function toggleSwapPick(registrationId: string) {
    setSwapPicks((prev) => {
      if (prev.includes(registrationId)) return prev.filter((id) => id !== registrationId);
      if (prev.length >= 2) return [prev[1], registrationId];
      return [...prev, registrationId];
    });
  }

  function confirmSwap() {
    if (swapPicks.length !== 2) return;
    runAction(
      swapPartyMemberAction({
        date,
        memberARegistrationId: swapPicks[0],
        memberBRegistrationId: swapPicks[1],
      }),
      "Swapped.",
    );
    setSwapPicks([]);
  }

  function renderGroup(
    label: string,
    groupKey: PendingGroupKey,
    members: BoardMember[],
    accent: boolean,
    emptyText: string,
  ) {
    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-2",
          accent ? "border-court-blue/40 bg-court-blue/[0.06]" : "bg-muted/20",
        )}
      >
        <p
          className={cn(
            "mb-2 text-xs font-semibold tracking-wide uppercase",
            accent ? "text-court-blue" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const picked = swapPicks.includes(member.registrationId);
              return (
                <div
                  key={member.registrationId}
                  className={cn(
                    // bg-card, not bg-background: bg-background flips
                    // dark in this app's dark theme while the chip still
                    // inherits the surrounding Card's fixed-dark
                    // text-card-foreground (Card intentionally stays
                    // white/light in both themes — see card.tsx) —
                    // dark-on-dark, functionally invisible. Confirmed
                    // live: reported as "black box, text is black."
                    "bg-card flex items-center gap-1 rounded-md border px-2 py-1 text-sm",
                    picked && "border-court-blue ring-court-blue/40 ring-2",
                  )}
                >
                  <span className="text-card-foreground font-medium">
                    {displayPlayerName(member.playerName)}
                  </span>
                  {/* text-card-foreground/N, not text-muted-foreground:
                      muted-foreground flips light in this app's dark
                      theme, which is illegible on this chip's always-
                      white bg-card — same failure mode as the name text
                      above, just for the icon row. card-foreground is
                      pinned dark in both themes (see card.tsx), so /50
                      opacity of it stays readable-but-secondary
                      regardless of the page theme. */}
                  <button
                    type="button"
                    className={cn(
                      "text-card-foreground/50 hover:text-court-blue",
                      picked && "text-court-blue",
                    )}
                    aria-label={
                      picked
                        ? `Deselect ${member.playerName} for swap`
                        : `Select ${member.playerName} to swap groups`
                    }
                    disabled={isPending}
                    onClick={() => toggleSwapPick(member.registrationId)}
                  >
                    <ArrowLeftRight className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-card-foreground/50 hover:text-destructive"
                    aria-label={`Remove ${member.playerName} from the queue`}
                    disabled={isPending}
                    onClick={() =>
                      runAction(
                        cancelRegistrationAction({ registrationId: member.registrationId }),
                        "Removed from the queue.",
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {members.length >= 2 ? (
          vacantCourts.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">
              All courts are busy — nothing to assign to right now.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="border-input rounded-md border px-2 py-1 text-xs"
                value={assignCourtPicks[groupKey]}
                onChange={(event) =>
                  setAssignCourtPicks((prev) => ({ ...prev, [groupKey]: event.target.value }))
                }
                disabled={isPending}
              >
                <option value="">Assign to court…</option>
                {vacantCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending || !assignCourtPicks[groupKey]}
                onClick={() => assignGroup(groupKey, members)}
              >
                Assign
              </Button>
            </div>
          )
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Next up</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {renderGroup("Next up", "nextUp", nextUp, true, "Nobody waiting")}
        {renderGroup("After that", "afterThat", afterThat, false, "—")}
        {renderGroup("Then", "then", then, false, "—")}
        {swapPicks.length > 0 ? (
          <div className="border-court-blue/40 bg-court-blue/[0.06] flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
            <p className="text-sm">
              {swapPicks.length === 1
                ? `Pick one more player to swap with ${displayPlayerName(flatMembers.find((m) => m.registrationId === swapPicks[0])?.playerName ?? "")}.`
                : `Swap ${displayPlayerName(flatMembers.find((m) => m.registrationId === swapPicks[0])?.playerName ?? "")} with ${displayPlayerName(
                    flatMembers.find((m) => m.registrationId === swapPicks[1])?.playerName ?? "",
                  )} — trades who's in each other's group.`}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isPending || swapPicks.length !== 2}
                onClick={confirmSwap}
              >
                Swap
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => setSwapPicks([])}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RotationBoard({
  date,
  courts,
  waiting,
  resting,
  maxWaitMinutes,
  unfillableQueueReason,
}: RotationBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manualPicks, setManualPicks] = useState<string[]>([]);
  const [manualCourtId, setManualCourtId] = useState<string>(courts[0]?.id ?? "");
  // Queue reorder: which unit each OTHER unit is currently set to move
  // after, keyed by the mover's own unitKey — a plain <select>, kept
  // alongside drag-and-drop (below) as the precise/keyboard-friendly
  // fallback on a busy front-desk laptop where a drag can misfire.
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  // Drag-and-drop reorder: the unitKey currently being dragged, and which
  // unitKey it's hovering over (for a drop-target highlight). Dropping
  // calls the same moveQueueUnitAfterAction as the "Move after" select —
  // this is just a second way to trigger the identical move.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

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
      prev.includes(registrationId)
        ? prev.filter((id) => id !== registrationId)
        : [...prev, registrationId],
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
  const flatWaitingMembers = waiting.flatMap((unit) => unit.members);
  const flatWaitingIds = flatWaitingMembers.map((member) => member.registrationId);
  const quickQueueIds = flatWaitingIds.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      {unfillableQueueReason ? (
        <div className="border-coral/40 bg-coral/[0.08] text-coral flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium">
          <span aria-hidden="true">⚠</span>
          <span>Queue can&apos;t be filled right now — {unfillableQueueReason}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {courts.map((court) => (
          <Card key={court.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {court.name}
                {court.active ? (
                  <Badge>On court</Badge>
                ) : court.proposed ? (
                  <Badge variant="outline">Proposed</Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {court.active ? (
                <>
                  <ul className="text-sm">
                    {court.active.participants.map((p) => (
                      <li key={p.registrationId}>
                        {displayPlayerName(p.playerName)} · {skillLabel(p.skillLevel)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {court.active.source === "MANUAL"
                      ? "Manual group"
                      : `Skill spread ${court.active.skillSpread}`}{" "}
                    · started{" "}
                    {court.active.startedAt
                      ? new Date(court.active.startedAt).toLocaleTimeString("en-PH", {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </p>
                  {(() => {
                    const remaining = formatGameTimeRemaining(court.active.endAt);
                    if (!remaining) return null;
                    return (
                      <Badge variant={remaining.overtime ? "warning" : "outline"} className="w-fit">
                        {remaining.text}
                      </Badge>
                    );
                  })()}
                  {/* Two rows, not one flex-wrap row — a 4th button
                      (Time's up) made a single row feel crowded on this
                      card's width. Top row: talk to the players
                      (Announce calls them on, Time's up calls them off).
                      Bottom row: resolve the game (Complete/Cancel). */}
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(
                            announceAssignmentAction({ assignmentId: court.active!.id }),
                            "Announced.",
                          )
                        }
                      >
                        Announce
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(
                            announceTimesUpAction({ assignmentId: court.active!.id }),
                            "Time's up announced.",
                          )
                        }
                      >
                        Time&apos;s up
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          runAction(
                            completeAssignmentAction({ assignmentId: court.active!.id }),
                            "Game complete.",
                          )
                        }
                      >
                        Complete game
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() =>
                          runAction(
                            cancelAssignmentAction({ assignmentId: court.active!.id }),
                            "Game cancelled.",
                          )
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </>
              ) : court.proposed ? (
                <>
                  <ul className="text-sm">
                    {court.proposed.participants.map((p) => (
                      <li key={p.registrationId}>
                        {displayPlayerName(p.playerName)} · {skillLabel(p.skillLevel)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    {court.proposed.source === "MANUAL"
                      ? "Manual group"
                      : `Skill spread ${court.proposed.skillSpread}`}
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
                        runAction(
                          announceAssignmentAction({ assignmentId: court.proposed!.id }),
                          "Announced.",
                        )
                      }
                    >
                      Announce
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        runAction(
                          confirmAssignmentAction({ assignmentId: court.proposed!.id }),
                          "Timer started.",
                        )
                      }
                    >
                      Start timer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        runAction(
                          cancelAssignmentAction({ assignmentId: court.proposed!.id }),
                          "Proposal discarded.",
                        )
                      }
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
                    onClick={() =>
                      runAction(
                        proposeAssignmentAction({ date, courtId: court.id }),
                        "Group proposed.",
                      )
                    }
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
                        createManualAssignmentAction({
                          date,
                          courtId: court.id,
                          registrationIds: quickQueueIds,
                        }),
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
          <CardTitle>Build a group by hand</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Pick 2 to 4 from the waiting list below (checkboxes), choose a court, then create —
            skill is ignored entirely. Fewer than 4 is real, valid ₱35/game play — early mornings, a
            short-handed group. Discards any pending auto-proposal on that court.
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
              disabled={
                isPending || manualPicks.length < 2 || manualPicks.length > 4 || !manualCourtId
              }
              onClick={() =>
                runAction(
                  createManualAssignmentAction({
                    date,
                    courtId: manualCourtId,
                    registrationIds: manualPicks,
                  }).then((r) => {
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

      <NextUpSection
        date={date}
        flatMembers={flatWaitingMembers}
        courts={courts}
        runAction={runAction}
        isPending={isPending}
      />

      <Card>
        <CardHeader>
          <CardTitle>Waiting ({waiting.reduce((n, u) => n + u.members.length, 0)})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody waiting.</p>
          ) : (
            <>
              <p className="text-muted-foreground -mt-1 text-xs">
                Drag a row onto another to reorder, or use &quot;Move after&quot; below.
              </p>
              {waiting.map((unit) => {
                const thisKey = unitKey(unit);
                const otherUnits = waiting.filter((other) => unitKey(other) !== thisKey);
                const moveTarget = moveTargets[thisKey] ?? "";
                return (
                  <div
                    key={thisKey}
                    draggable
                    onDragStart={() => setDraggingKey(thisKey)}
                    onDragEnd={() => {
                      setDraggingKey(null);
                      setDragOverKey(null);
                    }}
                    onDragOver={(event) => {
                      if (!draggingKey || draggingKey === thisKey) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverKey(thisKey);
                    }}
                    onDragLeave={() => setDragOverKey((prev) => (prev === thisKey ? null : prev))}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverKey(null);
                      setDraggingKey(null);
                      if (!draggingKey || draggingKey === thisKey) return;
                      const movingUnit = waiting.find((other) => unitKey(other) === draggingKey);
                      if (!movingUnit) return;
                      runAction(
                        moveQueueUnitAfterAction({
                          date,
                          movingRegistrationIds: movingUnit.members.map(
                            (member) => member.registrationId,
                          ),
                          targetRegistrationId: unit.members[0].registrationId,
                        }),
                        "Moved.",
                      );
                    }}
                    className={cn(
                      "flex cursor-grab flex-col gap-2 rounded-lg border px-3 py-2 active:cursor-grabbing",
                      unit.pastMaxWait && "border-coral/40 bg-coral/[0.08]",
                      draggingKey === thisKey && "opacity-50",
                      dragOverKey === thisKey && "border-court-blue ring-court-blue/40 ring-2",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {unit.members.map((member) => {
                          const picked = manualPicks.includes(member.registrationId);
                          return (
                            <label
                              key={member.registrationId}
                              className="flex items-center gap-1.5 text-sm"
                            >
                              {/* Reported live: the raw, unstyled native
                                checkbox rendered as an ambiguous solid
                                dark square against this app's dark theme
                                — no visible border, no clear "this is
                                checkable" affordance. appearance-none +
                                explicit white background/border gives an
                                unmistakable unchecked state; the checkmark
                                icon is drawn separately (appearance-none
                                removes the native glyph too), overlaid
                                only while checked. */}
                              <span className="relative inline-flex size-4 shrink-0">
                                <input
                                  type="checkbox"
                                  checked={picked}
                                  onChange={() => toggleManualPick(member.registrationId)}
                                  className="border-input checked:border-court-blue checked:bg-court-blue size-4 shrink-0 cursor-pointer appearance-none rounded border-2 bg-white"
                                />
                                {picked ? (
                                  <Check
                                    className="pointer-events-none absolute inset-0 size-4 p-0.5 text-white"
                                    strokeWidth={3}
                                    aria-hidden="true"
                                  />
                                ) : null}
                              </span>
                              {displayPlayerName(member.playerName)}{" "}
                              <span className="text-muted-foreground text-xs">
                                ({skillLabel(member.skillLevel)})
                              </span>
                            </label>
                          );
                        })}
                        {unit.partyId ? <Badge variant="outline">party</Badge> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-xs",
                            unit.pastMaxWait ? "text-coral font-semibold" : "text-muted-foreground",
                          )}
                        >
                          waiting {unit.waitMinutes}m
                          {unit.pastMaxWait ? ` (past ${maxWaitMinutes}m)` : ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            runAction(
                              markRestingAction({ queueEntryId: unit.members[0].queueEntryId }),
                              "Marked resting.",
                            )
                          }
                        >
                          Rest
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            runAction(
                              markDoneAction({ queueEntryId: unit.members[0].queueEntryId }),
                              "Marked done.",
                            )
                          }
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
                                movingRegistrationIds: unit.members.map(
                                  (member) => member.registrationId,
                                ),
                                targetRegistrationId: moveTarget,
                              }).then((r) => {
                                if (!r.error)
                                  setMoveTargets((prev) => ({ ...prev, [thisKey]: "" }));
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
              })}
            </>
          )}
        </CardContent>
      </Card>

      {resting.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Resting ({resting.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {resting.map((player) => (
              <div
                key={player.queueEntryId}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <span className="text-sm">
                  {displayPlayerName(player.playerName)}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({skillLabel(player.skillLevel)})
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    runAction(
                      markWaitingAgainAction({ queueEntryId: player.queueEntryId }),
                      "Back in the queue.",
                    )
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
