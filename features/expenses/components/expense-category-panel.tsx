"use client";

import { Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createExpenseCategoryAction,
  setExpenseCategoryActiveAction,
  updateExpenseCategoryAction,
} from "@/actions/expense-category.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordCard, recordCardAccentButtonClass } from "@/components/ui/record-card";
import { Switch } from "@/components/ui/switch";
import type { expenseCategoryService } from "@/services/expenses/expense-category.service";

type ExpenseCategories = Awaited<ReturnType<typeof expenseCategoryService.listCategories>>;

interface ExpenseCategoryPanelProps {
  categories: ExpenseCategories;
}

// ExpenseCategory has no natural per-row brand color the way PaymentMethod
// does (GCash blue, cash amber, etc.) — every row uses the same neutral
// ramp, same fallback PaymentMethodsWorkspace uses for a key it doesn't
// recognize.
const RAMP = "slate" as const;

function ExpenseCategoryRow({ category }: { category: ExpenseCategories[number] }) {
  const router = useRouter();
  const nameId = useId();
  const orderId = useId();
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [isSaving, startSaveTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();

  function handleSave() {
    startSaveTransition(async () => {
      const result = await updateExpenseCategoryAction(category.id, {
        name,
        sortOrder: Number(sortOrder),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Category saved.");
      router.refresh();
    });
  }

  function handleToggleActive() {
    startToggleTransition(async () => {
      const result = await setExpenseCategoryActiveAction(category.id, !category.isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(category.isActive ? "Category disabled." : "Category enabled.");
      router.refresh();
    });
  }

  return (
    <RecordCard ramp={RAMP} icon={Tag} title={category.name} active={category.isActive}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={nameId} className="text-muted-foreground text-xs">
              Name
            </Label>
            <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex w-20 flex-col gap-1.5">
            <Label htmlFor={orderId} className="text-muted-foreground text-xs">
              Order
            </Label>
            <Input
              id={orderId}
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={handleSave}
            className={recordCardAccentButtonClass(RAMP)}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={category.isActive}
            onCheckedChange={handleToggleActive}
            disabled={isToggling}
            aria-label={category.isActive ? "Disable category" : "Enable category"}
          />
          <span className="text-muted-foreground text-xs">
            {category.isActive ? "Active — tap to disable" : "Disabled — tap to enable"}
          </span>
        </div>
      </div>
    </RecordCard>
  );
}

function AddExpenseCategoryForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    startTransition(async () => {
      const result = await createExpenseCategoryAction({ name: name.trim() });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Category added.");
      setName("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a category</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="expenseCategoryName">Name</Label>
            <Input
              id="expenseCategoryName"
              placeholder="Marketing"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Adding…" : "Add category"}
          </Button>
        </form>
        {serverError ? (
          <p className="text-destructive mt-2 text-sm" role="alert">
            {serverError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ExpenseCategoryPanel({ categories }: ExpenseCategoryPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <AddExpenseCategoryForm />

      {categories.length === 0 ? (
        <EmptyState title="No expense categories yet." description="Add one above to get started." />
      ) : (
        <div className="flex flex-col gap-3">
          {categories.map((category) => (
            <ExpenseCategoryRow key={category.id} category={category} />
          ))}
        </div>
      )}
    </div>
  );
}
