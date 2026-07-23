import type { Metadata } from "next";

import { CourtForm } from "@/features/courts/components/court-form";

export const metadata: Metadata = {
  title: "New Court",
};

// No permission check needed here — middleware (lib/rbac.ts) already
// requires courts:manage for this exact route before the page renders.
export default function NewCourtPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New court</h1>
        <p className="text-muted-foreground text-sm">Add a new court to the facility.</p>
      </div>
      <CourtForm />
    </div>
  );
}
