import type { Metadata } from "next";

import { EquipmentForm } from "@/features/equipment/components/equipment-form";

export const metadata: Metadata = {
  title: "New Equipment",
};

export default function NewEquipmentPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New equipment</h1>
        <p className="text-muted-foreground text-sm">Add a new equipment type to the rental inventory.</p>
      </div>
      <EquipmentForm />
    </div>
  );
}
