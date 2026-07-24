"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlaySettingsAction } from "@/actions/open-play-checkin.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OpenPlaySettingsPanel({ noShowReleaseMinutes }: { noShowReleaseMinutes: number }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(noShowReleaseMinutes);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setOpenPlaySettingsAction({ noShowReleaseMinutes: minutes });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check-in Settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Label htmlFor="noShowReleaseMinutes">No-show release (minutes after session start)</Label>
        <p className="text-muted-foreground text-xs">
          A Fri/Sat registration not checked in within this window is marked no-show, freeing their seat for
          the waitlist. Never auto-refunded — flagged for staff.
        </p>
        <div className="flex gap-2">
          <Input
            id="noShowReleaseMinutes"
            type="number"
            min={1}
            className="w-24"
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
          <Button type="button" size="sm" disabled={isPending} onClick={save}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
