"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { enrollMembershipAction } from "@/actions/membership.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { enrollMembershipSchema } from "@/features/memberships/schemas/membership.schema";

interface PlanOption {
  id: string;
  name: string;
}

interface PaymentMethodOption {
  id: string;
  label: string;
}

interface EnrollMembershipFormProps {
  playerId: string;
  plans: PlanOption[];
  paymentMethods: PaymentMethodOption[];
}

interface EnrollFormValues {
  membershipPlanId: string;
  startDate: string;
  autoRenew: boolean;
  paymentMethodId: string;
}

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function EnrollMembershipForm({ playerId, plans, paymentMethods }: EnrollMembershipFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { handleSubmit, control, register } = useForm<EnrollFormValues>({
    defaultValues: {
      membershipPlanId: plans[0]?.id ?? "",
      startDate: toDateInputValue(new Date()),
      autoRenew: false,
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = enrollMembershipSchema.safeParse({
      membershipPlanId: values.membershipPlanId,
      startDate: new Date(`${values.startDate}T00:00:00`),
      autoRenew: values.autoRenew,
      paymentMethodId: values.paymentMethodId,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid enrollment details.");
      return;
    }

    startTransition(async () => {
      const result = await enrollMembershipAction(playerId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Membership enrolled.");
      router.refresh();
    });
  });

  if (plans.length === 0) {
    return <p className="text-muted-foreground text-sm">No active membership plans to enroll in.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="membershipPlanId">Plan</Label>
        <Controller
          control={control}
          name="membershipPlanId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="membershipPlanId" className="w-full">
                <SelectValue placeholder="Select a plan">
                  {(value: string) => plans.find((plan) => plan.id === value)?.name ?? "Select a plan"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startDate">Start date</Label>
        <Input id="startDate" type="date" {...register("startDate")} />
      </div>

      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="autoRenew"
          render={({ field }) => (
            <Switch id="autoRenew" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Label htmlFor="autoRenew">Auto-renew</Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="paymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="paymentMethodId" className="w-full">
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

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Enrolling…" : "Enroll membership"}
      </Button>
    </form>
  );
}
