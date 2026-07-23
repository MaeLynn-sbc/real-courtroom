"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteSettingAction, upsertSettingAction } from "@/actions/settings.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { settingsService } from "@/services/settings/settings.service";

type Settings = Awaited<ReturnType<typeof settingsService.listSettings>>;

interface SettingsWorkspaceProps {
  settings: Settings;
}

function settingValueToText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function SettingRow({ setting }: { setting: Settings[number] }) {
  const router = useRouter();
  const [value, setValue] = useState(settingValueToText(setting.value));
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSave() {
    startSaveTransition(async () => {
      const result = await upsertSettingAction({
        key: setting.key,
        value,
        description: setting.description ?? undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Setting saved.");
      router.refresh();
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteSettingAction(setting.key);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Setting removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{setting.key}</p>
          {setting.description ? (
            <p className="text-muted-foreground text-xs">{setting.description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input value={value} onChange={(event) => setValue(event.target.value)} className="flex-1" />
        <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        <ConfirmActionButton
          title="Remove this setting?"
          description={`This deletes "${setting.key}". This can't be undone.`}
          confirmLabel="Remove"
          disabled={isDeleting}
          onConfirm={handleDelete}
        >
          Remove
        </ConfirmActionButton>
      </div>
    </div>
  );
}

function AddSettingForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    startTransition(async () => {
      const result = await upsertSettingAction({ key, value, description: description || undefined });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Setting added.");
      setKey("");
      setValue("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a setting</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settingKey">Key</Label>
              <Input id="settingKey" value={key} onChange={(event) => setKey(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settingValue">Value</Label>
              <Input id="settingValue" value={value} onChange={(event) => setValue(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settingDescription">Description (optional)</Label>
            <Input
              id="settingDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Adding…" : "Add setting"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsWorkspace({ settings }: SettingsWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <AddSettingForm />

      {settings.length === 0 ? (
        <EmptyState title="No settings yet." description="Add one above to get started." />
      ) : (
        <div className="flex flex-col gap-3">
          {settings.map((setting) => (
            <SettingRow key={setting.id} setting={setting} />
          ))}
        </div>
      )}
    </div>
  );
}
