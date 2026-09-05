"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createManualMatchAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STAGE_LABELS } from "@/lib/match-stage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ManualMatchTeamOption {
  teamId: string;
  name: string;
}

interface ManualMatchFormProps {
  tournamentId: string;
  categoryId: string;
  teams: ManualMatchTeamOption[];
}

// Owner request (2026-08-11): "the bracketing might be done live via
// wheel of fortune in the internet so that everybody can see it" — the
// draw itself happens on an external site, on camera. This just records
// whatever pairing that produces, one at a time. Round is optional and
// purely a display grouping in BracketView (e.g. use it to keep "Group
// A" and "Group B" matches visually separate) — there's no real pool
// concept in the schema, deliberately, per the owner's own scoping
// answer (manual match builder over a real Pool A/B model).
export function ManualMatchForm({ tournamentId, categoryId, teams }: ManualMatchFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [team1Id, setTeam1Id] = useState("");
  const [team2Id, setTeam2Id] = useState("");
  const [round, setRound] = useState("");
  // "" means a pool fixture with no stage. Anything else marks this a
  // playoff match and puts it in the public PLAYOFFS section.
  const [stage, setStage] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!team1Id || !team2Id) return;

    startTransition(async () => {
      const result = await createManualMatchAction(tournamentId, categoryId, {
        team1Id,
        team2Id,
        round: round.trim() ? Number(round) : undefined,
        stage: stage
          ? (stage as "ELIMINATION" | "QUARTERFINAL" | "SEMIFINAL" | "BRONZE" | "FINAL")
          : undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Match added.");
      setTeam1Id("");
      setTeam2Id("");
      setRound("");
      // Stage is deliberately NOT cleared: playoff matches are added in
      // a run (SF1, SF2, then Bronze and Final), so keeping the last
      // choice saves re-picking it every time.
      router.refresh();
    });
  }

  if (teams.length < 2) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a match manually</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Enter a matchup directly — e.g. as pairs come out of a live draw. Round is optional,
            just for keeping groups visually separate below.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manualMatchTeam1">Team 1</Label>
              <Select value={team1Id} onValueChange={(value) => value && setTeam1Id(value)}>
                <SelectTrigger id="manualMatchTeam1">
                  <SelectValue>{teams.find((t) => t.teamId === team1Id)?.name ?? "Select"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.teamId} value={team.teamId} disabled={team.teamId === team2Id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manualMatchTeam2">Team 2</Label>
              <Select value={team2Id} onValueChange={(value) => value && setTeam2Id(value)}>
                <SelectTrigger id="manualMatchTeam2">
                  <SelectValue>{teams.find((t) => t.teamId === team2Id)?.name ?? "Select"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.teamId} value={team.teamId} disabled={team.teamId === team1Id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manualMatchRound">Round (optional)</Label>
              <Input
                id="manualMatchRound"
                type="number"
                min={1}
                value={round}
                onChange={(event) => setRound(event.target.value)}
                placeholder="e.g. 1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manualMatchStage">Stage (optional)</Label>
              <Select value={stage} onValueChange={(value) => setStage(value ?? "")}>
                <SelectTrigger id="manualMatchStage" className="w-full">
                  <SelectValue placeholder="Pool match">
                    {(selected: string) => STAGE_LABELS[selected] ?? "Pool match"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STAGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending || !team1Id || !team2Id} className="w-full">
                {isPending ? "Adding…" : "Add match"}
              </Button>
            </div>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
