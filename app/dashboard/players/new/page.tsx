import type { Metadata } from "next";

import { PlayerForm } from "@/features/players/components/player-form";

export const metadata: Metadata = {
  title: "New Player",
};

export default function NewPlayerPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New player</h1>
        <p className="text-muted-foreground text-sm">
          Creates a new player profile and member account.
        </p>
      </div>
      <PlayerForm />
    </div>
  );
}
