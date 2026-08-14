"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { removeTournamentLogoAction, uploadTournamentLogoAction } from "@/actions/tournament.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TournamentLogoUploadProps {
  tournamentId: string;
  logoUrl: string | null;
}

// Owner request (2026-08-15): "use their logo... place where i can
// upload it once it changes" — the organizer's own tournament branding,
// shown on /tourtv (see tournament-tv-display-client.tsx's header).
// Same upload flow as features/cms/components/gallery-panel.tsx's own
// image upload (uncontrolled <input name="file">, form action passes
// FormData straight to the server action).
export function TournamentLogoUpload({ tournamentId, logoUrl }: TournamentLogoUploadProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isUploading, startUploadTransition] = useTransition();
  const [isRemoving, startRemoveTransition] = useTransition();

  function handleUpload(formData: FormData) {
    startUploadTransition(async () => {
      const result = await uploadTournamentLogoAction(tournamentId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo uploaded.");
      formRef.current?.reset();
      setSelectedFileName(null);
      router.refresh();
    });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      const result = await removeTournamentLogoAction(tournamentId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {logoUrl ? (
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-20 items-center justify-center overflow-hidden rounded-lg border">
            <Image
              src={logoUrl}
              alt="Tournament logo"
              width={80}
              height={80}
              className="object-contain"
              unoptimized
            />
          </div>
          <Button type="button" variant="outline" size="sm" disabled={isRemoving} onClick={handleRemove}>
            {isRemoving ? "Removing…" : "Remove logo"}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No logo uploaded yet — shown as plain text on /tourtv.</p>
      )}

      <form ref={formRef} action={handleUpload} className="flex items-center gap-3">
        <label
          htmlFor="tournamentLogoFile"
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}
        >
          {logoUrl ? "Replace logo" : "Choose file"}
        </label>
        <span className="text-muted-foreground truncate text-sm">{selectedFileName ?? "No file selected"}</span>
        <input
          id="tournamentLogoFile"
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? null)}
        />
        <Button type="submit" size="sm" disabled={isUploading || !selectedFileName}>
          {isUploading ? "Uploading…" : "Upload"}
        </Button>
      </form>
    </div>
  );
}
