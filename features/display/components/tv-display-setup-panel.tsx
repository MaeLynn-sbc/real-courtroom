"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  regenerateDisplaySlugAction,
  setAnnouncementRepeatCountAction,
  setTimeUpFlashDurationAction,
} from "@/actions/display.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TvDisplaySetupPanelProps {
  displayUrl: string;
  shortDisplayUrl: string;
  displayQrDataUrl: string;
  openPlayRegistrationUrl: string;
  openPlayQrDataUrl: string;
  canRegenerate: boolean;
  announcementRepeatCount: number;
  timeUpFlashDurationSeconds: number;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function TvDisplaySetupPanel({
  displayUrl,
  shortDisplayUrl,
  displayQrDataUrl,
  openPlayRegistrationUrl,
  openPlayQrDataUrl,
  canRegenerate,
  announcementRepeatCount,
  timeUpFlashDurationSeconds,
}: TvDisplaySetupPanelProps) {
  const [url, setUrl] = useState(displayUrl);
  const [qrDataUrl, setQrDataUrl] = useState(displayQrDataUrl);
  const [isPending, startTransition] = useTransition();
  const [repeatCountInput, setRepeatCountInput] = useState(String(announcementRepeatCount));
  const [isSavingRepeatCount, startRepeatCountTransition] = useTransition();
  const [flashDurationInput, setFlashDurationInput] = useState(String(timeUpFlashDurationSeconds));
  const [isSavingFlashDuration, startFlashDurationTransition] = useTransition();

  function handleSaveRepeatCount() {
    const value = Number(repeatCountInput);
    startRepeatCountTransition(async () => {
      const result = await setAnnouncementRepeatCountAction(value);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Announcement repeat count saved.");
    });
  }

  function handleSaveFlashDuration() {
    const value = Number(flashDurationInput);
    startFlashDurationTransition(async () => {
      const result = await setTimeUpFlashDurationAction(value);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Time's-up flash duration saved.");
    });
  }

  function handleRegenerate() {
    if (!confirm("This invalidates the current URL — the TV will need to be pointed at the new one. Continue?")) {
      return;
    }
    startTransition(async () => {
      const result = await regenerateDisplaySlugAction();
      if (result.error || !result.slug) {
        toast.error(result.error ?? "Failed to regenerate the URL.");
        return;
      }
      const newUrl = new URL(url);
      newUrl.pathname = `/display/${result.slug}`;
      setUrl(newUrl.toString());
      toast.success("URL regenerated — update the TV before the old one stops working.");
      // Re-fetch the QR for the new URL (client-side is fine here — it's
      // just a data: URL render, no server secret involved in doing it
      // browser-side too, but simplest to just ask the server action's
      // own page revalidation to catch it on next load; for the
      // immediate visual, blank the stale QR so nobody scans an old code).
      setQrDataUrl("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Display URL</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <code className="bg-muted flex-1 overflow-x-auto rounded-md px-3 py-2 text-sm">{url}</code>
            <CopyButton value={url} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image
              <img src={qrDataUrl} alt="Display URL QR code" width={160} height={160} className="rounded-lg border" />
            ) : (
              <p className="text-muted-foreground text-sm">
                QR regenerating — reload this page to see the new code.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <a href={url} target="_blank" rel="noreferrer">
                <Button type="button" variant="outline" size="sm">
                  Open display in new tab
                </Button>
              </a>
              {canRegenerate ? (
                <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleRegenerate}>
                  {isPending ? "Regenerating…" : "Regenerate URL"}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium">Short URL, for typing on the TV&apos;s remote</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Fixed and memorable, unlike the URL above — which also means it isn&apos;t a secret the way that one
              is. Same live data either way; this one just doesn&apos;t change when you regenerate the URL above.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="bg-muted flex-1 overflow-x-auto rounded-md px-3 py-2 text-sm">{shortDisplayUrl}</code>
              <CopyButton value={shortDisplayUrl} />
              <a href={shortDisplayUrl} target="_blank" rel="noreferrer">
                <Button type="button" variant="outline" size="sm">
                  Open
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="aspect-video w-full overflow-hidden rounded-lg border">
            <iframe src={url} title="TV display preview" className="h-full w-full" loading="lazy" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open Play registration QR</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Print or display this for players to scan and self-register for open play on their own phone.
          </p>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image */}
            <img
              src={openPlayQrDataUrl}
              alt="Open Play registration QR code"
              width={160}
              height={160}
              className="rounded-lg border"
            />
            <div className="flex items-center gap-2">
              <code className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs">{openPlayRegistrationUrl}</code>
              <CopyButton value={openPlayRegistrationUrl} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice announcements</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            How many times each court-assignment announcement plays, with a short pause between — a court is
            noisy and people miss the first pass. Set to 1 to go back to a single announcement.
          </p>
          {canRegenerate ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="announcementRepeatCount">Repeat count</Label>
                <Input
                  id="announcementRepeatCount"
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  className="w-24"
                  value={repeatCountInput}
                  onChange={(event) => setRepeatCountInput(event.target.value)}
                />
              </div>
              <Button type="button" size="sm" disabled={isSavingRepeatCount} onClick={handleSaveRepeatCount}>
                {isSavingRepeatCount ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              Currently plays <span className="font-medium">{announcementRepeatCount}</span> time
              {announcementRepeatCount === 1 ? "" : "s"}. Only an owner can change this.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time&apos;s-up flash</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            When a court booking reaches its end time, that court&apos;s card flashes on the display so it&apos;s
            noticeable from across the room. How many seconds it keeps flashing before stopping on its own.
          </p>
          {canRegenerate ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="timeUpFlashDuration">Flash duration (seconds)</Label>
                <Input
                  id="timeUpFlashDuration"
                  type="number"
                  min={30}
                  max={600}
                  step={1}
                  className="w-24"
                  value={flashDurationInput}
                  onChange={(event) => setFlashDurationInput(event.target.value)}
                />
              </div>
              <Button type="button" size="sm" disabled={isSavingFlashDuration} onClick={handleSaveFlashDuration}>
                {isSavingFlashDuration ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              Currently flashes for <span className="font-medium">{timeUpFlashDurationSeconds}</span> seconds.
              Only an owner can change this.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>Open the display URL above on the TV&apos;s browser (or scan the QR code from a phone already
              connected to the TV via screen mirroring).</li>
            <li>Tap &quot;Start display&quot; once — this enters fullscreen and keeps the screen awake.</li>
            <li>Leave it running. It reconnects automatically on a brief wifi drop and reloads itself every 6
              hours to pick up updates.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
