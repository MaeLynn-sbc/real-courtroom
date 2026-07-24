"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setCapacityDefaultAction } from "@/actions/open-play-capacity.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CapacityDefaultsPanelProps {
  fridayCapacity: number;
  saturdayCapacity: number;
}

export function CapacityDefaultsPanel({ fridayCapacity, saturdayCapacity }: CapacityDefaultsPanelProps) {
  const router = useRouter();
  const [friday, setFriday] = useState(fridayCapacity);
  const [saturday, setSaturday] = useState(saturdayCapacity);
  const [isPending, startTransition] = useTransition();

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekday Defaults</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          Applies to every upcoming Friday/Saturday that doesn&apos;t already have its own override below. No
          upper limit — any positive number is accepted.
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
              <Button type="button" size="sm" disabled={isPending} onClick={() => save(5, friday)}>
                Save
              </Button>
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
              <Button type="button" size="sm" disabled={isPending} onClick={() => save(6, saturday)}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
