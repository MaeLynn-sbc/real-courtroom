"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setClosedMessageForDateAction } from "@/actions/open-play-capacity.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClosedMessageFieldProps {
  date: string; // "YYYY-MM-DD"
  message: string | null;
}

const MAX_LENGTH = 200;

// Per-date override for the closed-registration message, shown on every
// public surface in place of the global default when this date is
// blocked. Deliberately NOT gated on the block toggle rendered right
// above this (OnlineRegistrationBlockToggle) — an owner can write this
// ahead of flipping that switch, or leave it parked without ever
// blocking the date. Saving an empty field clears the override (stored
// as null, not ""), falling back to the global default everywhere —
// same one-way-in-both-directions shape as every other clearable text
// setting in this codebase.
export function ClosedMessageField({ date, message }: ClosedMessageFieldProps) {
  const router = useRouter();
  const [value, setValue] = useState(message ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await setClosedMessageForDateAction({ date, message: value });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        value.trim() ? "Message saved for this date." : "Cleared — using the global default.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="closedMessage" className="text-muted-foreground text-xs">
        Closed message for this date (blank = use the global default)
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="closedMessage"
          value={value}
          maxLength={MAX_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          className="max-w-md"
        />
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <span className="text-muted-foreground text-[11px]">
        {value.length}/{MAX_LENGTH}
      </span>
    </div>
  );
}
