"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cancelSpecialEventAction,
  deleteSpecialEventAction,
  updateSpecialEventTimingAction,
} from "@/actions/court.actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SpecialEventRow {
  id: string;
  courtName: string;
  reason: string;
  notes: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
}

interface SpecialEventListProps {
  events: SpecialEventRow[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

const STATUS_VARIANT: Record<string, "status" | "outline" | "destructive"> = {
  SCHEDULED: "status",
  IN_PROGRESS: "status",
  COMPLETED: "outline",
  CANCELLED: "destructive",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CancelButton({ maintenanceId }: { maintenanceId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await cancelSpecialEventAction(maintenanceId);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Event block cancelled.");
          router.refresh();
        });
      }}
    >
      {isPending ? "Cancelling…" : "Cancel"}
    </Button>
  );
}

// Owner request (2026-08-09): "i want an option to delete cancelled
// events" — real delete, confirmed first since it's irreversible
// (unlike Cancel, which just flips a status). Only ever rendered for
// CANCELLED rows — see deleteSpecialEvent's own guard.
function DeleteButton({ maintenanceId }: { maintenanceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSpecialEventAction(maintenanceId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Event deleted.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this cancelled event?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from the list permanently. It&apos;s already cancelled and blocking nothing, so
            this is just cleanup — there&apos;s no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Keep it</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={handleDelete}>
            {isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Owner request (2026-08-09): "u can edit the time and date if the
// organizers change their minds" — edits this one row's window in
// place, no need to cancel and re-create.
function EditTimingRow({ event, onDone }: { event: SpecialEventRow; onDone: () => void }) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(toDateInputValue(event.startAt));
  const [startTime, setStartTime] = useState(toTimeInputValue(event.startAt));
  const [endDate, setEndDate] = useState(toDateInputValue(event.endAt));
  const [endTime, setEndTime] = useState(toTimeInputValue(event.endAt));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    if (!startDate || !startTime || !endDate || !endTime) {
      setError("Pick a date and time for both Starts and Ends.");
      return;
    }
    startTransition(async () => {
      const result = await updateSpecialEventTimingAction({
        maintenanceId: event.id,
        startAt: new Date(`${startDate}T${startTime}`),
        endAt: new Date(`${endDate}T${endTime}`),
      });
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Event timing updated.");
      router.refresh();
      onDone();
    });
  }

  return (
    <TableRow>
      <TableCell colSpan={6}>
        <div className="flex flex-col gap-3 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Starts</span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="Start date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Input
                  type="time"
                  aria-label="Start time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Ends</span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="End date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <Input
                  type="time"
                  aria-label="End time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onDone}>
              Cancel edit
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function SpecialEventList({ events }: SpecialEventListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">No special events scheduled.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Court</TableHead>
          <TableHead>Starts</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => {
          const editable = event.status === "SCHEDULED" || event.status === "IN_PROGRESS";
          if (editingId === event.id) {
            return <EditTimingRow key={event.id} event={event} onDone={() => setEditingId(null)} />;
          }
          return (
            <TableRow key={event.id}>
              <TableCell className="font-medium">
                {event.reason}
                {event.notes ? (
                  <p className="text-muted-foreground text-xs font-normal">{event.notes}</p>
                ) : null}
              </TableCell>
              <TableCell>{event.courtName}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {dateTimeFormatter.format(event.startAt)}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {dateTimeFormatter.format(event.endAt)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[event.status] ?? "outline"}>
                  {event.status.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell>
                {editable ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(event.id)}>
                      Edit
                    </Button>
                    <CancelButton maintenanceId={event.id} />
                  </div>
                ) : event.status === "CANCELLED" ? (
                  <DeleteButton maintenanceId={event.id} />
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
