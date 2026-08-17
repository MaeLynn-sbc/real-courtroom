"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTournamentSlugAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TournamentSlugFormProps {
  tournamentId: string;
  slug: string;
}

// Owner request (2026-08-17): "can u make it shorter. just
// sayansandfriends?" — the auto-derived slug uses the whole tournament
// name, which is right as a default but too long for a poster. The short
// form can't be derived by any general rule (dropping "Pickleball
// Tournament" isn't guessable for the next tournament), so staff set it
// here, on an already-created tournament.
//
// Same small, focused, live-saving control shape as
// TournamentPaymentSettingToggle and TournamentLogoUpload on this page —
// deliberately not a full tournament edit form, which doesn't exist.
export function TournamentSlugForm({ tournamentId, slug }: TournamentSlugFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(slug);
  const [isPending, startTransition] = useTransition();

  const trimmed = value.trim();
  const isDirty = trimmed !== slug && trimmed.length > 0;

  function handleSave() {
    if (!isDirty) {
      return;
    }
    // Says plainly what breaks. The cuid fallback in
    // getTournamentBySlugOrId does NOT cover this — the OLD slug simply
    // stops resolving once it's replaced.
    const confirmed = window.confirm(
      `Change the public URL to /tournaments/${trimmed}?\n\n` +
        `Anyone who already has the old link (/tournaments/${slug}) will get a "not found" page.`,
    );
    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await updateTournamentSlugAction(tournamentId, { slug: trimmed });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Public URL updated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="tournament-slug">Public URL</Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-sm">/tournaments/</span>
        <Input
          id="tournament-slug"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          className="w-56"
          aria-label="Public URL for this tournament"
        />
        <Button type="button" onClick={handleSave} disabled={!isDirty || isPending} size="sm">
          {isPending ? "Saving…" : "Save URL"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Spaces and punctuation become dashes. Keep it short and easy to type — it goes on posters.
      </p>
    </div>
  );
}
