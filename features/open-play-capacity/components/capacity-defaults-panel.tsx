"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  setCapacityDefaultAction,
  setOnlineRegistrationEnabledAction,
} from "@/actions/open-play-capacity.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface CapacityDefaultsPanelProps {
  fridayCapacity: number;
  saturdayCapacity: number;
  fridayOnlineRegistrationEnabled: boolean;
  saturdayOnlineRegistrationEnabled: boolean;
}

export function CapacityDefaultsPanel({
  fridayCapacity,
  saturdayCapacity,
  fridayOnlineRegistrationEnabled,
  saturdayOnlineRegistrationEnabled,
}: CapacityDefaultsPanelProps) {
  const router = useRouter();
  const [friday, setFriday] = useState(fridayCapacity);
  const [saturday, setSaturday] = useState(saturdayCapacity);
  const [isPending, startTransition] = useTransition();
  const [isTogglePending, startToggleTransition] = useTransition();
  // Collapsed by default (item 5, Fri/Sat waitlist rework) — this is a
  // rarely-touched setup panel, not day-to-day operational content;
  // opening the page straight to it pushed the actual night-of/upcoming-
  // nights list below the fold every time.
  const [isOpen, setIsOpen] = useState(false);

  function save(dayOfWeek: 5 | 6, capacity: number) {
    startTransition(async () => {
      const result = await setCapacityDefaultAction({ dayOfWeek, capacity });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Capacity default saved.");
      router.refresh();
    });
  }

  // Open-play online self-registration, Gate 1 follow-up (BUILD-SPEC.md
  // §6). Independent of the capacity number above and independent of
  // the feature-wide switch (still off, elsewhere) — this only decides
  // which of Friday/Saturday would offer online registration once that
  // switch is on. Live-toggled, same tone="status" convention as every
  // other live/persisted settings toggle in the dashboard (BUILD-SPEC.md
  // §2), not a form field batched into the capacity Save button beside it.
  function toggleOnlineRegistration(dayOfWeek: 5 | 6, enabled: boolean) {
    startToggleTransition(async () => {
      const result = await setOnlineRegistrationEnabledAction({ dayOfWeek, enabled });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Online registration ${enabled ? "enabled" : "disabled"}.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle>Weekday Defaults</CardTitle>
          {isOpen ? (
            <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          )}
        </button>
      </CardHeader>
      {isOpen ? (
        <CardContent className="flex flex-col gap-6">
          <p className="text-muted-foreground text-sm">
            Applies to every upcoming Friday/Saturday that doesn&apos;t already have its own
            override below. No upper limit — any positive number is accepted.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fridayCapacity">Friday</Label>
              <div className="flex gap-2">
                <Input
                  id="fridayCapacity"
                  type="number"
                  min={1}
                  value={friday}
                  onChange={(event) => setFriday(Number(event.target.value))}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => save(5, friday)}
                >
                  Save
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={fridayOnlineRegistrationEnabled}
                  onCheckedChange={(checked) => toggleOnlineRegistration(5, checked)}
                  disabled={isTogglePending}
                  tone="status"
                  aria-label="Friday online registration"
                />
                <span className="text-muted-foreground text-xs">
                  Online registration {fridayOnlineRegistrationEnabled ? "on" : "off"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saturdayCapacity">Saturday</Label>
              <div className="flex gap-2">
                <Input
                  id="saturdayCapacity"
                  type="number"
                  min={1}
                  value={saturday}
                  onChange={(event) => setSaturday(Number(event.target.value))}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => save(6, saturday)}
                >
                  Save
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={saturdayOnlineRegistrationEnabled}
                  onCheckedChange={(checked) => toggleOnlineRegistration(6, checked)}
                  disabled={isTogglePending}
                  tone="status"
                  aria-label="Saturday online registration"
                />
                <span className="text-muted-foreground text-xs">
                  Online registration {saturdayOnlineRegistrationEnabled ? "on" : "off"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
