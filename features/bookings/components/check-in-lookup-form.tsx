"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { checkInByTokenAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CheckInLookupFormProps {
  initialToken?: string;
}

export function CheckInLookupForm({ initialToken }: CheckInLookupFormProps) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await checkInByTokenAction({ token });
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Checked in.");
      if (result.bookingId) {
        router.push(`/dashboard/bookings/${result.bookingId}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="token">Check-in code</Label>
        <Input
          id="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste or scan the check-in code"
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <Button type="submit" disabled={isPending || token.trim().length === 0}>
        {isPending ? "Checking in…" : "Confirm check-in"}
      </Button>
    </form>
  );
}
