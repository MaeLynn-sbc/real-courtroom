"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { registerTeamAction } from "@/actions/tournament.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { registerTeamSchema } from "@/features/tournaments/schemas/tournament.schema";
import { cn } from "@/lib/utils";

const NO_PARTNER_VALUE = "__none__";

// Same FileReader -> strip "data:...;base64," prefix pattern as
// expense-entry-form.tsx / record-gcash-payment-form.tsx /
// open-play-registration-proof-form.tsx — duplicated here rather than
// shared, matching this codebase's established "duplicate small helpers,
// don't share" precedent for tiny per-form utils.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface RegistrationFormPlayer {
  id: string;
  label: string;
}

interface RegistrationFormPaymentMethod {
  id: string;
  label: string;
}

interface RegistrationFormValues {
  player1Id: string;
  player2Id: string;
  paymentMethodId: string;
}

interface RegistrationFormProps {
  tournamentId: string;
  categoryId: string;
  players: RegistrationFormPlayer[];
  paymentMethods: RegistrationFormPaymentMethod[];
}

export function RegistrationForm({
  tournamentId,
  categoryId,
  players,
  paymentMethods,
}: RegistrationFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    handleSubmit,
    control,
    reset,
    watch,
  } = useForm<RegistrationFormValues>({
    defaultValues: {
      player1Id: players[0]?.id ?? "",
      player2Id: NO_PARTNER_VALUE,
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const player1Id = watch("player1Id");

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = registerTeamSchema.safeParse({
      player1Id: values.player1Id,
      player2Id: values.player2Id === NO_PARTNER_VALUE ? undefined : values.player2Id,
      paymentMethodId: values.paymentMethodId,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid registration details.");
      return;
    }

    startTransition(async () => {
      const result = await registerTeamAction(tournamentId, categoryId, {
        ...parsed.data,
        receipt: receipt
          ? {
              fileName: receipt.name,
              contentType: receipt.type || "image/png",
              dataBase64: await fileToBase64(receipt),
            }
          : undefined,
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Team registered.");
      reset({
        player1Id: values.player1Id,
        player2Id: NO_PARTNER_VALUE,
        paymentMethodId: values.paymentMethodId,
      });
      setReceipt(null);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="player1Id">Player</Label>
        <Controller
          control={control}
          name="player1Id"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="player1Id" className="w-full">
                <SelectValue placeholder="Select a player">
                  {(value: string) => players.find((player) => player.id === value)?.label ?? "Select a player"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="player2Id">Partner (doubles only)</Label>
        <Controller
          control={control}
          name="player2Id"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="player2Id" className="w-full">
                <SelectValue placeholder="No partner — singles">
                  {(value: string) =>
                    value === NO_PARTNER_VALUE
                      ? "No partner — singles"
                      : (players.find((player) => player.id === value)?.label ?? "No partner — singles")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARTNER_VALUE}>No partner — singles</SelectItem>
                {players
                  .filter((player) => player.id !== player1Id)
                  .map((player) => (
                    <SelectItem key={player.id} value={player.id}>
                      {player.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="registrationPaymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="registrationPaymentMethodId" className="w-full">
                <SelectValue placeholder="Select a payment method">
                  {(value: string) =>
                    paymentMethods.find((method) => method.id === value)?.label ??
                    "Select a payment method"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="registrationReceipt">Payment receipt (optional)</Label>
        {/* Same fix as expense-entry-form's receipt field — see that
            component's own comment for why a raw Input type="file"
            button text could go nearly invisible. */}
        <div className="flex items-center gap-3">
          <label
            htmlFor="registrationReceipt"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}
          >
            Choose file
          </label>
          <span className="text-muted-foreground truncate text-sm">
            {receipt ? receipt.name : "No file selected"}
          </span>
        </div>
        <input
          id="registrationReceipt"
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
        />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Registering…" : "Register team"}
      </Button>
    </form>
  );
}
