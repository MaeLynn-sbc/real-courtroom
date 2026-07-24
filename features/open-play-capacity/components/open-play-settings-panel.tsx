"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlaySettingsAction } from "@/actions/open-play-checkin.actions";
import type { OpenPlaySettings } from "@/features/cms/schemas/cms.schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function OpenPlaySettingsPanel(props: OpenPlaySettings) {
  const router = useRouter();
  const [settings, setSettings] = useState<OpenPlaySettings>(props);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setOpenPlaySettingsAction(settings);
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
        <CardTitle>Check-in & Rotation Settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="noShowReleaseMinutes">No-show release (minutes after session start)</Label>
          <p className="text-muted-foreground text-xs">
            A Fri/Sat registration not checked in within this window is marked no-show, freeing their seat for
            the waitlist. Never auto-refunded — flagged for staff.
          </p>
          <Input
            id="noShowReleaseMinutes"
            type="number"
            min={1}
            className="w-24"
            value={settings.noShowReleaseMinutes}
            onChange={(event) => setSettings((s) => ({ ...s, noShowReleaseMinutes: Number(event.target.value) }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="maxWaitMinutes">Max wait before starvation guard (minutes)</Label>
          <p className="text-muted-foreground text-xs">
            A waiting player past this long is force-anchored on the next court regardless of skill fit — the
            one advanced player on a beginner-heavy night still plays.
          </p>
          <Input
            id="maxWaitMinutes"
            type="number"
            min={1}
            className="w-24"
            value={settings.maxWaitMinutes}
            onChange={(event) => setSettings((s) => ({ ...s, maxWaitMinutes: Number(event.target.value) }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skillWindow">Skill window (starting distance)</Label>
          <p className="text-muted-foreground text-xs">
            Auto-pairing starts by matching within this many skill levels of the anchor, then widens if a
            court would otherwise sit idle.
          </p>
          <Input
            id="skillWindow"
            type="number"
            min={0}
            className="w-24"
            value={settings.skillWindow}
            onChange={(event) => setSettings((s) => ({ ...s, skillWindow: Number(event.target.value) }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="weeknightGameRateCents">Weeknight game rate (₱, per game)</Label>
          <p className="text-muted-foreground text-xs">
            Snapshotted onto each weeknight player&apos;s tab as they check in — changing this never rewrites
            an already-open tab.
          </p>
          <Input
            id="weeknightGameRateCents"
            type="number"
            min={0}
            step={0.01}
            className="w-24"
            value={settings.weeknightGameRateCents / 100}
            onChange={(event) => setSettings((s) => ({ ...s, weeknightGameRateCents: Math.round(Number(event.target.value) * 100) }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetGameMinutes">Target game length (minutes, informational)</Label>
          <Input
            id="targetGameMinutes"
            type="number"
            min={1}
            className="w-24"
            value={settings.targetGameMinutes}
            onChange={(event) => setSettings((s) => ({ ...s, targetGameMinutes: Number(event.target.value) }))}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="autoConfirmProposals"
            checked={settings.autoConfirmProposals}
            onCheckedChange={(checked) => setSettings((s) => ({ ...s, autoConfirmProposals: checked }))}
          />
          <Label htmlFor="autoConfirmProposals">Auto-confirm proposed foursomes</Label>
        </div>

        <div>
          <Button type="button" size="sm" disabled={isPending} onClick={save}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
