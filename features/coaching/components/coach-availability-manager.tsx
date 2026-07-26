"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createAvailabilityWindowAction, deleteAvailabilityWindowAction } from "@/actions/coaching.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { coachAvailabilityService } from "@/services/coaching/coach-availability.service";

type Coach = Awaited<ReturnType<typeof coachAvailabilityService.listCoaches>>[number];
type Window = Awaited<ReturnType<typeof coachAvailabilityService.listWindows>>[number];

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

interface CoachAvailabilityManagerProps {
  coaches: Coach[];
  selectedCoachId: string;
  isOwnCalendar: boolean;
  windows: Window[];
}

export function CoachAvailabilityManager({
  coaches,
  selectedCoachId,
  isOwnCalendar,
  windows,
}: CoachAvailabilityManagerProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [notes, setNotes] = useState("");

  function onSelectCoach(coachId: string) {
    router.push(`/dashboard/coaching/availability?coachId=${coachId}`);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!startAt || !endAt) {
      setServerError("Enter a start and end time.");
      return;
    }

    startTransition(async () => {
      const result = await createAvailabilityWindowAction({
        coachId: selectedCoachId,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        notes: notes || undefined,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Availability window added.");
      setStartAt("");
      setEndAt("");
      setNotes("");
      router.refresh();
    });
  }

  function onDelete(windowId: string) {
    startTransition(async () => {
      const result = await deleteAvailabilityWindowAction(windowId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Window removed.");
      router.refresh();
    });
  }

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

      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startAt">Opens</Label>
          <Input
            id="startAt"
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endAt">Closes</Label>
          <Input id="endAt" type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <Button type="submit" disabled={isPending || !selectedCoachId}>
          {isPending ? "Adding…" : "Add window"}
        </Button>
      </form>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      {windows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No availability windows yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opens</TableHead>
              <TableHead>Closes</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {windows.map((window) => (
              <TableRow key={window.id}>
                <TableCell>{dateTimeFormatter.format(window.startAt)}</TableCell>
                <TableCell>{dateTimeFormatter.format(window.endAt)}</TableCell>
                <TableCell>{window.notes ?? "—"}</TableCell>
                <TableCell>
                  <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => onDelete(window.id)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
