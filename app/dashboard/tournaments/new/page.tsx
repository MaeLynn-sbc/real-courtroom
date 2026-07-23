import type { Metadata } from "next";

import { TournamentForm } from "@/features/tournaments/components/tournament-form";

export const metadata: Metadata = {
  title: "New Tournament",
};

export default function NewTournamentPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New tournament</h1>
        <p className="text-muted-foreground text-sm">
          Set the tournament&rsquo;s dates and venue — categories are added next.
        </p>
      </div>
      <TournamentForm />
    </div>
  );
}
