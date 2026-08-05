"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { registerTeamAction } from "@/actions/tournament.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface RegistrationFormPaymentMethod {
  id: string;
  label: string;
}

interface RegistrationFormValues {
  player1Name: string;
  player2Name: string;
  paymentMethodId: string;
}

interface RegistrationFormProps {
  tournamentId: string;
  categoryId: string;
  paymentMethods: RegistrationFormPaymentMethod[];
  // Owner request (2026-08-05): false for an outside event where
  // entrants already paid the organizers directly — the payment method
  // and receipt fields don't apply, and registerTeamAction won't
  // require a shift or record a Sale either (see that action's own
  // comment).
  collectsPaymentOnSite: boolean;
}

// No dropdown (owner, 2026-08-03): tournament entrants are frequently
// walk-ins with no existing Player record, so staff type both names
// directly — registerTeam creates a minimal Player for each name on the
// spot. Always 2 slots since most categories are doubles; player 2 is
// left blank for a singles match.
export function RegistrationForm({
  tournamentId,
  categoryId,
  paymentMethods,
  collectsPaymentOnSite,
}: RegistrationFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  const { handleSubmit, control, register, reset } = useForm<RegistrationFormValues>({
    defaultValues: {
      player1Name: "",
      player2Name: "",
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = registerTeamSchema.safeParse({
      player1Name: values.player1Name.trim(),
      player2Name: values.player2Name.trim() || undefined,
      paymentMethodId: collectsPaymentOnSite ? values.paymentMethodId : undefined,
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
      reset({ player1Name: "", player2Name: "", paymentMethodId: values.paymentMethodId });
      setReceipt(null);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="player1Name">Player 1 name</Label>
        <Input id="player1Name" {...register("player1Name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="player2Name">Player 2 name (doubles — leave blank for singles)</Label>
        <Input id="player2Name" {...register("player2Name")} />
      </div>

      {collectsPaymentOnSite ? (
        <>
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
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          Payment isn&apos;t collected here for this tournament — entrants already paid the
          organizers directly.
        </p>
      )}

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Registering…" : "Register team"}
      </Button>
    </form>
  );
}
