"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cancelMembershipAction,
  changePlanAction,
  reactivateMembershipAction,
  renewMembershipAction,
  suspendMembershipAction,
} from "@/actions/membership.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MembershipStatus } from "@/lib/generated/prisma/enums";
// Only the pure state-machine module is imported here (no lib/env.ts /
// lib/prisma.ts in its dependency chain) — never import
// membership.service.ts itself from a "use client" file.
import { MEMBERSHIP_STATUS_TRANSITIONS } from "@/services/memberships/membership-status";

interface PlanOption {
  id: string;
  name: string;
}

interface MembershipStatusActionsProps {
  membershipId: string;
  currentStatus: MembershipStatus;
  currentPlanId: string;
  plans: PlanOption[];
  playerId?: string;
}

export function MembershipStatusActions({
  membershipId,
  currentStatus,
  currentPlanId,
  plans,
  playerId,
}: MembershipStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlanId);
  const [note, setNote] = useState("");

  const availableTransitions = MEMBERSHIP_STATUS_TRANSITIONS[currentStatus];
  const canCancel = availableTransitions.includes("CANCELLED");
  const canReactivate = currentStatus === "CANCELLED" && availableTransitions.includes("ACTIVE");
  const canRenew = currentStatus === "ACTIVE" || currentStatus === "EXPIRED";

  function handleAction(action: () => Promise<{ error: string | null }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {canRenew ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() =>
              handleAction(() => renewMembershipAction(membershipId, playerId), "Membership renewed.")
            }
          >
            Renew
          </Button>
        ) : null}
        {canReactivate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              handleAction(
                () => reactivateMembershipAction(membershipId, playerId),
                "Membership reactivated.",
              )
            }
          >
            Reactivate
          </Button>
        ) : null}
      </div>

      {currentStatus !== "CANCELLED" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="changePlanId" className="text-xs font-medium">
              Change plan
            </label>
            <Select
              value={selectedPlanId}
              onValueChange={(value) => setSelectedPlanId(value ?? currentPlanId)}
            >
              <SelectTrigger id="changePlanId" className="w-48">
                <SelectValue>
                  {(value: string) => plans.find((plan) => plan.id === value)?.name ?? "Select a plan"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || selectedPlanId === currentPlanId}
            onClick={() =>
              handleAction(
                () => changePlanAction(membershipId, { membershipPlanId: selectedPlanId }, playerId),
                "Plan changed.",
              )
            }
          >
            Change plan
          </Button>
        </div>
      ) : null}

      {canCancel ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="suspendCancelNote" className="text-xs font-medium">
              Reason (optional)
            </label>
            <Input
              id="suspendCancelNote"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-56"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              handleAction(
                () => suspendMembershipAction(membershipId, { note: note || undefined }, playerId),
                "Membership suspended.",
              )
            }
          >
            Suspend
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              handleAction(
                () => cancelMembershipAction(membershipId, { note: note || undefined }, playerId),
                "Membership cancelled.",
              )
            }
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
