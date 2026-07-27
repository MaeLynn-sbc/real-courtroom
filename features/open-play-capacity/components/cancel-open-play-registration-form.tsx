"use client";

import { useState, useTransition } from "react";

import { cancelPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration-cancellation.actions";
import { Button } from "@/components/ui/button";

interface CancelOpenPlayRegistrationFormProps {
  registrationId: string;
  phone: string;
}

// Confirm-then-cancel, same two-step shape as every other destructive
// action in this app's dashboard (e.g. AddPaymentMethodForm's sibling
// disable controls) — a single click can't accidentally cancel a real,
// paid registration.
export function CancelOpenPlayRegistrationForm({ registrationId, phone }: CancelOpenPlayRegistrationFormProps) {
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (cancelled) {
    return <p className="text-success text-sm">Your registration has been cancelled.</p>;
  }

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        Cancel my registration
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">Are you sure? This can&apos;t be undone.</p>
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setServerError(null);
            startTransition(async () => {
              const result = await cancelPublicOpenPlayRegistrationAction({ registrationId, phone });
              if (result.error) {
                setServerError(result.error);
                return;
              }
              setCancelled(true);
            });
          }}
        >
          {isPending ? "Cancelling…" : "Yes, cancel it"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirming(false)}>
          Never mind
        </Button>
      </div>
    </div>
  );
}
