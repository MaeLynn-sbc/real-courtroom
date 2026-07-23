import type { Metadata } from "next";

import { SessionForm } from "@/features/open-play/components/session-form";

export const metadata: Metadata = {
  title: "New Open Play Session",
};

export default function NewOpenPlaySessionPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Open Play session</h1>
        <p className="text-muted-foreground text-sm">
          Schedule a session and set its player capacity.
        </p>
      </div>
      <SessionForm />
    </div>
  );
}
