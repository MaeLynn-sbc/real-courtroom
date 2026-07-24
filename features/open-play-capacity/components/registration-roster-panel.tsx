"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { cancelRegistrationAction, markNoShowAction } from "@/actions/open-play-registration.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

interface RosterRegistration {
  id: string;
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  status: string;
  waitlistPos: number | null;
}

interface RegistrationRosterPanelProps {
  registrations: RosterRegistration[];
  skillBreakdown: Record<OpenPlaySkillLevel, number>;
  capacity: number;
}

function RowActions({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: (input: { registrationId: string }) => Promise<{ error: string | null }>, label: string) {
    startTransition(async () => {
      const result = await action({ registrationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run(markNoShowAction, "Marked no-show.")}
      >
        No-show
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => run(cancelRegistrationAction, "Registration cancelled.")}
      >
        Cancel
      </Button>
    </div>
  );
}

export function RegistrationRosterPanel({ registrations, skillBreakdown, capacity }: RegistrationRosterPanelProps) {
  const seated = registrations.filter((r) => r.status === "CONFIRMED" && r.waitlistPos === null);
  const waitlisted = registrations.filter((r) => r.waitlistPos !== null);
  const active = registrations.filter((r) => r.status === "CONFIRMED");

  const breakdownText = OPEN_PLAY_SKILL_LEVEL_ORDER.map(
    (level) => `${skillBreakdown[level]} ${OPEN_PLAY_SKILL_LEVELS[level].label.toLowerCase()}`,
  ).join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">
            {seated.length} / {capacity} · {waitlisted.length} waiting
          </span>
          {active.length > 0 ? <span className="text-muted-foreground">{breakdownText}</span> : null}
        </div>

        {registrations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No registrations yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map((registration) => (
                <TableRow key={registration.id}>
                  <TableCell className="font-medium">{registration.playerName}</TableCell>
                  <TableCell>{registration.phone}</TableCell>
                  <TableCell>{OPEN_PLAY_SKILL_LEVELS[registration.skillLevel].label}</TableCell>
                  <TableCell>
                    {registration.status !== "CONFIRMED" ? (
                      <Badge variant="destructive">{registration.status.replace("_", " ")}</Badge>
                    ) : registration.waitlistPos !== null ? (
                      <Badge variant="warning">Waitlist #{registration.waitlistPos}</Badge>
                    ) : (
                      <Badge variant="success">Confirmed</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {registration.status === "CONFIRMED" ? <RowActions registrationId={registration.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
