import type { Metadata } from "next";

import { LockerForm } from "@/features/lockers/components/locker-form";

export const metadata: Metadata = {
  title: "New Locker",
};

export default function NewLockerPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New locker</h1>
        <p className="text-muted-foreground text-sm">Add a new locker to the facility.</p>
      </div>
      <LockerForm />
    </div>
  );
}
