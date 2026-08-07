"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createExpenseAction } from "@/actions/expense.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ExpenseEntryCategory {
  id: string;
  name: string;
}

interface ExpenseEntryPaymentMethod {
  id: string;
  label: string;
}

interface ExpenseEntryFormProps {
  categories: ExpenseEntryCategory[];
  paymentMethods: ExpenseEntryPaymentMethod[];
  // Reconciliation-workspace embedding (owner request, 2026-08-07): the
  // plain /dashboard/admin/expenses page omits both, keeping today +
  // the first payment method exactly as before. Embedded in a specific
  // day's cash/GCash reconciliation, these default the form to that
  // same date and payment method instead, so recording the expense that
  // explains today's deficit doesn't require re-picking either.
  defaultDate?: string;
  defaultPaymentMethodId?: string;
}

interface ExpenseEntryFormValues {
  amount: string;
  date: string;
  description: string;
  categoryId: string;
  paymentMethodId: string;
}

function todayDateValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Same FileReader -> strip "data:...;base64," prefix pattern as
// record-gcash-payment-form.tsx / open-play-registration-proof-form.tsx —
// duplicated here rather than shared, matching this codebase's established
// "duplicate small helpers, don't share" precedent for tiny per-form utils.
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

export function ExpenseEntryForm({ categories, paymentMethods }: ExpenseEntryFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  const { control, register, handleSubmit, reset } = useForm<ExpenseEntryFormValues>({
    defaultValues: {
      amount: "",
      date: todayDateValue(),
      description: "",
      categoryId: categories[0]?.id ?? "",
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const amountCents = Math.round(Number(values.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setServerError("Enter a valid amount.");
      return;
    }
    if (!values.description.trim()) {
      setServerError("Enter a description.");
      return;
    }

    startTransition(async () => {
      const result = await createExpenseAction({
        amountCents,
        date: values.date,
        description: values.description.trim(),
        categoryId: values.categoryId,
        paymentMethodId: values.paymentMethodId,
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
      toast.success("Expense recorded.");
      reset({
        amount: "",
        date: todayDateValue(),
        description: "",
        categoryId: values.categoryId,
        paymentMethodId: values.paymentMethodId,
      });
      setReceipt(null);
      router.refresh();
    });
  });

  if (categories.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Record an expense</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Add an expense category below before recording an expense.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record an expense</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expenseAmount">Amount (₱)</Label>
              <Input id="expenseAmount" type="number" step="0.01" min="0" {...register("amount")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expenseDate">Date</Label>
              <Input id="expenseDate" type="date" {...register("date")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expenseDescription">Description</Label>
            <Textarea id="expenseDescription" {...register("description")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expenseCategory">Category</Label>
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expenseCategory" className="w-full">
                      <SelectValue placeholder="Select a category">
                        {(value: string) => categories.find((category) => category.id === value)?.name ?? "Select a category"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expensePaymentMethod">Payment method</Label>
              <Controller
                control={control}
                name="paymentMethodId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expensePaymentMethod" className="w-full">
                      <SelectValue placeholder="Select a payment method">
                        {(value: string) =>
                          paymentMethods.find((method) => method.id === value)?.label ?? "Select a payment method"
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expenseReceipt">Receipt (optional)</Label>
            {/* Same fix as the public payment-proof upload fields — see
                that component's own comment for why the raw Input
                type="file" button text could go nearly invisible. */}
            <div className="flex items-center gap-3">
              <label htmlFor="expenseReceipt" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}>
                Choose file
              </label>
              <span className="text-muted-foreground truncate text-sm">
                {receipt ? receipt.name : "No file selected"}
              </span>
            </div>
            <input
              id="expenseReceipt"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
            />
          </div>

          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending} className="self-start">
            {isPending ? "Recording…" : "Record expense"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
