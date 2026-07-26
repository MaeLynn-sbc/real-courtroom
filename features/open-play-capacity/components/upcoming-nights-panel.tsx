"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setSessionCapacityOverrideAction } from "@/actions/open-play-capacity.actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UpcomingNight {
  date: string; // "YYYY-MM-DD"
  label: string; // "Fri, Jul 24"
  capacity: number;
  isOverride: boolean;
  status: string | null;
  registeredCount: number;
  waitlistedCount: number;
}

function NightRow({ night }: { night: UpcomingNight }) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(night.capacity);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setSessionCapacityOverrideAction({ date: night.date, capacity });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${night.label} capacity saved.`);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={`night-${night.date}`}>{night.label}</Label>
        {night.isOverride ? (
          <Badge variant="secondary">Override</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">from default</span>
        )}
        {night.registeredCount > 0 || night.waitlistedCount > 0 ? (
          <span className="text-muted-foreground text-xs">
            {night.registeredCount} registered
            {night.waitlistedCount > 0 ? ` · ${night.waitlistedCount} waiting` : ""}
          </span>
        ) : null}
      </div>
      <Input
        id={`night-${night.date}`}
        type="number"
        min={1}
        className="w-24"
        value={capacity}
        onChange={(event) => setCapacity(Number(event.target.value))}
      />
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={save}>
        Save
      </Button>
      <Link href={`/dashboard/admin/open-play-capacity/${night.date}`} className={buttonVariants({ size: "sm" })}>
        Roster
      </Link>
    </div>
  );
}

export function UpcomingNightsPanel({ nights }: { nights: UpcomingNight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Nights</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Override a single date without changing the weekday default. Dates with no override yet show what
          they&apos;d inherit if left alone.
        </p>
        <div className="flex flex-col gap-2">
          {nights.map((night) => (
            <NightRow key={night.date} night={night} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
