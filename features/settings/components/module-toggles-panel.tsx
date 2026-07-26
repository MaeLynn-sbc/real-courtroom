"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setModuleEnabledAction } from "@/actions/module-settings.actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MODULE_KEYS, type EnabledModules, type ModuleKey } from "@/lib/module-flags";

const MODULE_ROWS: { key: ModuleKey; label: string; description: string }[] = [
  {
    key: MODULE_KEYS.MEMBERSHIP,
    label: "Membership",
    description: "Enrolling players into a membership plan.",
  },
  {
    key: MODULE_KEYS.LOCKER_RENTAL,
    label: "Locker Rental",
    description: "Renting a locker to a player.",
  },
  {
    key: MODULE_KEYS.TOURNAMENT_REGISTRATION,
    label: "Tournament Registration",
    description: "Registering a team for a tournament category.",
  },
];

function ModuleToggleRow({
  moduleKey,
  label,
  description,
  enabled,
}: {
  moduleKey: ModuleKey;
  label: string;
  description: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await setModuleEnabledAction(moduleKey, checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} ${checked ? "enabled" : "disabled"}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {/* BUILD-SPEC.md §2 — a live, immediately-persisted "is this
          module active" toggle, the same status semantics as payment
          methods' own Switch, so it gets the dedicated status color
          rather than the default action green. */}
      <Switch
        checked={enabled}
        onCheckedChange={handleChange}
        disabled={isPending}
        aria-label={label}
        tone="status"
      />
    </div>
  );
}

export function ModuleTogglesPanel({ enabledModules }: { enabledModules: EnabledModules }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Modules</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Turn a module off to hide its sign-up flow while keeping all existing data and management
          screens intact. Booking and Equipment (paddle) rental are always on.
        </p>
        {MODULE_ROWS.map((row) => (
          <ModuleToggleRow
            key={row.key}
            moduleKey={row.key}
            label={row.label}
            description={row.description}
            enabled={enabledModules[row.key]}
          />
        ))}
      </CardContent>
    </Card>
  );
}
