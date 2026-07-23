"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setCourtStatusAction } from "@/actions/court.actions";
import { Button } from "@/components/ui/button";
import type { Court } from "@/lib/generated/prisma/client";
import type { CourtStatus } from "@/lib/generated/prisma/enums";

const STATUS_OPTIONS: { status: CourtStatus; label: string }[] = [
  { status: "ACTIVE", label: "Set active" },
  { status: "MAINTENANCE", label: "Set under maintenance" },
  { status: "DISABLED", label: "Disable" },
];

interface CourtStatusControlsProps {
  court: Court;
}

export function CourtStatusControls({ court }: CourtStatusControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(status: CourtStatus) {
    startTransition(async () => {
      const result = await setCourtStatusAction(court.id, status);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Court status updated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_OPTIONS.map((option) => (
        <Button
          key={option.status}
          type="button"
          size="sm"
          variant={option.status === "DISABLED" ? "destructive" : "outline"}
          disabled={isPending || court.status === option.status}
          onClick={() => handleChange(option.status)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
