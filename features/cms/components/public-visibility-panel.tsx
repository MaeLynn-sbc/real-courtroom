"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setPublicVisibilityAction } from "@/actions/cms.actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  PUBLIC_VISIBILITY_KEYS,
  type PublicVisibilityFlags,
  type PublicVisibilityKey,
} from "@/lib/public-visibility";

const ROWS: { key: PublicVisibilityKey; label: string; description: string }[] = [
  {
    key: PUBLIC_VISIBILITY_KEYS.OPEN_PLAY,
    label: "Open Play",
    description: "Show the Open Play page and nav link on the public site.",
  },
  {
    key: PUBLIC_VISIBILITY_KEYS.TOURNAMENTS,
    label: "Tournament Registration",
    description: "Advertise tournaments to public visitors.",
  },
  {
    key: PUBLIC_VISIBILITY_KEYS.MEMBERSHIP,
    label: "Membership",
    description: "Advertise membership plans to public visitors.",
  },
  {
    key: PUBLIC_VISIBILITY_KEYS.PRODUCTS,
    label: "Product Store",
    description: "Show what's available for sale (balls, T-shirts, etc.) on the public site.",
  },
];

function VisibilityRow({
  visKey,
  label,
  description,
  visible,
}: {
  visKey: PublicVisibilityKey;
  label: string;
  description: string;
  visible: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await setPublicVisibilityAction(visKey, checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} ${checked ? "shown" : "hidden"} on the public site.`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {/* BUILD-SPEC.md §2 — same "live, persisted active toggle" status
          semantics as Modules above it in Settings, not a one-off form
          field, so it gets the dedicated status color too. */}
      <Switch checked={visible} onCheckedChange={handleChange} disabled={isPending} aria-label={label} tone="status" />
    </div>
  );
}

export function PublicVisibilityPanel({ visibility }: { visibility: PublicVisibilityFlags }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Public visibility</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Controls what the public website advertises — separate from whether staff can create these
          internally (see Modules in Settings).
        </p>
        {ROWS.map((row) => (
          <VisibilityRow
            key={row.key}
            visKey={row.key}
            label={row.label}
            description={row.description}
            visible={visibility[row.key]}
          />
        ))}
      </CardContent>
    </Card>
  );
}
