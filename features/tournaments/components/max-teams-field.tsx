"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateCategoryMaxTeamsAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MaxTeamsFieldProps {
  tournamentId: string;
  categoryId: string;
  maxTeams: number | null;
  confirmedCount: number;
}

// Reported live: createCategory's own maxTeams field is set-once, at
// creation — a category that already exists (like every one created
// before this field even existed, or one where staff left it blank)
// had no way back to it at all. Saving blank clears the limit
// (unlimited), same "empty means unset" convention the create form
// already uses — not a no-op, a real two-way write.
export function MaxTeamsField({
  tournamentId,
  categoryId,
  maxTeams,
  confirmedCount,
}: MaxTeamsFieldProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(maxTeams != null ? String(maxTeams) : "");

  function handleSave() {
    startTransition(async () => {
      const result = await updateCategoryMaxTeamsAction(tournamentId, categoryId, {
        maxTeams: value.trim() ? Number(value) : undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(value.trim() ? "Max teams updated." : "Limit cleared — unlimited teams.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="maxTeamsField" className="text-muted-foreground text-xs">
        Max teams (blank = unlimited) — {confirmedCount} confirmed so far
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="maxTeamsField"
          type="number"
          min={2}
          placeholder="No limit"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          className="w-28"
        />
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
