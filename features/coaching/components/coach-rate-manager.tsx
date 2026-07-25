"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteCoachRateAction, upsertCoachRateAction } from "@/actions/coaching.actions";
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
import { formatCurrency } from "@/lib/utils";
import type { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import type { coachRateService } from "@/services/coaching/coach-rate.service";

type Coach = Awaited<ReturnType<typeof coachAvailabilityService.listCoaches>>[number];
type Rate = Awaited<ReturnType<typeof coachRateService.listRates>>[number];

interface CoachRateManagerProps {
  coaches: Coach[];
  selectedCoachId: string;
  rates: Rate[];
}

export function CoachRateManager({ coaches, selectedCoachId, rates }: CoachRateManagerProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [groupSize, setGroupSize] = useState("1");
  const [priceCents, setPriceCents] = useState("");

  function onSelectCoach(coachId: string) {
    router.push(`/dashboard/coaching/rates?coachId=${coachId}`);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const price = Math.round(Number(priceCents) * 100);
    if (!selectedCoachId || !Number.isFinite(price) || price < 0) {
      setServerError("Enter a valid price.");
      return;
    }

    startTransition(async () => {
      const result = await upsertCoachRateAction({
        coachId: selectedCoachId,
        groupSize: Number(groupSize),
        priceCents: price,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Rate saved.");
      setPriceCents("");
      router.refresh();
    });
  }

  function onDelete(rateId: string) {
    startTransition(async () => {
      const result = await deleteCoachRateAction(rateId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Rate removed.");
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
      </div>

      {selectedCoachId ? (
        <>
          <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="priceCents">Price (₱)</Label>
              <Input
                id="priceCents"
                type="number"
                min={0}
                step="0.01"
                value={priceCents}
                onChange={(event) => setPriceCents(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save rate"}
            </Button>
          </form>

          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}

          {rates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rates set for this coach yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group size</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell>{rate.groupSize}</TableCell>
                    <TableCell>{formatCurrency(rate.priceCents)}</TableCell>
                    <TableCell>
                      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => onDelete(rate.id)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}
    </div>
  );
}
