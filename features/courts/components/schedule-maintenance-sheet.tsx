"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CourtMaintenanceForm } from "@/features/courts/components/court-maintenance-form";

interface ScheduleMaintenanceSheetProps {
  courtId: string;
}

export function ScheduleMaintenanceSheet({ courtId }: ScheduleMaintenanceSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button>Schedule maintenance</Button>} />
      <SheetContent side="right" className="w-96">
        <SheetHeader>
          <SheetTitle>Schedule maintenance</SheetTitle>
          <SheetDescription>Block this court out for a maintenance window.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CourtMaintenanceForm
            courtId={courtId}
            onScheduled={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
