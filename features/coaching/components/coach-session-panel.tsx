"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createCoachSessionAction } from "@/actions/coaching.actions";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import type { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import type { coachSessionService } from "@/services/coaching/coach-session.service";

type ExistingSession = NonNullable<Awaited<ReturnType<typeof coachSessionService.getByBookingId>>>;
type Coach = Awaited<ReturnType<typeof coachAvailabilityService.listCoaches>>[number];

interface CoachSessionPanelProps {
  bookingId: string;
  existingSession: ExistingSession | null;
  // All isCoach coaches, not just ones free for this slot — the staff
  // override needs to be able to pick a coach OUTSIDE their stated
  // windows, so the picker can't be pre-filtered down to only the
  // covered ones the way the (not-yet-built) public path will be.
  allCoaches: Coach[];
  availableCoachIds: Set<string>;
}

const SOURCE_LABELS: Record<string, string> = { PUBLIC: "Public", STAFF: "Staff", UNKNOWN: "Unknown" };

function ExistingCoachSession({ session }: { session: ExistingSession }) {
  const coachName = session.coach.user.name ?? session.coach.user.email ?? "—";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline">{SOURCE_LABELS[session.source]}</Badge>
        {session.isOutsideAvailability ? <Badge variant="warning">Outside Availability</Badge> : null}
      </div>
      <dl>
        <div className="flex justify-between py-1">
          <dt className="text-muted-foreground">Coach</dt>
          <dd>{coachName}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted-foreground">Group size</dt>
          <dd>{session.groupSize}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted-foreground">Rate</dt>
          <dd>{formatCurrency(session.rateCents)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{session.status}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted-foreground">Reference</dt>
          <dd className="font-mono">{session.sessionReference}</dd>
        </div>
      </dl>
    </div>
  );
}

function AddCoachForm({
  bookingId,
  allCoaches,
  availableCoachIds,
}: {
  bookingId: string;
  allCoaches: Coach[];
  availableCoachIds: Set<string>;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [coachId, setCoachId] = useState("");
  const [groupSize, setGroupSize] = useState("1");
  const [isOutsideAvailability, setIsOutsideAvailability] = useState(false);

  const selectedCoachIsAvailable = coachId ? availableCoachIds.has(coachId) : true;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!coachId) {
      setServerError("Select a coach.");
      return;
    }

    startTransition(async () => {
      const result = await createCoachSessionAction({
        bookingId,
        coachId,
        groupSize: Number(groupSize),
        isOutsideAvailability,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Coach added.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="coachId">Coach</Label>
        <Select value={coachId} onValueChange={(value) => setCoachId(value ?? "")}>
          <SelectTrigger id="coachId" className="w-full">
            <SelectValue placeholder="Select a coach">
              {(value: string) => {
                const coach = allCoaches.find((c) => c.id === value);
                return coach ? (coach.user.name ?? coach.user.email) : "Select a coach";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allCoaches.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-sm">No coaches on file.</div>
            ) : (
              allCoaches.map((coach) => (
                <SelectItem key={coach.id} value={coach.id}>
                  {coach.user.name ?? coach.user.email}
                  {availableCoachIds.has(coach.id) ? "" : " (not available this slot)"}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {!selectedCoachIsAvailable ? (
          <p className="text-warning-foreground text-xs">
            This coach doesn&apos;t have a window covering this slot — check &quot;Book outside
            availability&quot; below to proceed anyway.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="groupSize">Group size</Label>
        <Input
          id="groupSize"
          type="number"
          min={1}
          value={groupSize}
          onChange={(event) => setGroupSize(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Book outside availability</p>
          <p className="text-muted-foreground text-xs">
            Staff override — bypasses the coach&apos;s stated windows. Flagged for reporting.
          </p>
        </div>
        <Switch checked={isOutsideAvailability} onCheckedChange={setIsOutsideAvailability} />
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending ? "Adding…" : "Add coach"}
      </Button>
    </form>
  );
}

export function CoachSessionPanel({
  bookingId,
  existingSession,
  allCoaches,
  availableCoachIds,
}: CoachSessionPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="text-sm font-medium">Coach</h2>
      {existingSession ? (
        <ExistingCoachSession session={existingSession} />
      ) : (
        <AddCoachForm bookingId={bookingId} allCoaches={allCoaches} availableCoachIds={availableCoachIds} />
      )}
    </div>
  );
}
