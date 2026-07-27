import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseCategoryPanel } from "@/features/expenses/components/expense-category-panel";
import { ExpenseEntryForm } from "@/features/expenses/components/expense-entry-form";
import { ExpensesTable } from "@/features/expenses/components/expenses-table";
import { expenseCategoryService } from "@/services/expenses/expense-category.service";
import { expenseService } from "@/services/expenses/expense.service";
import { saleService } from "@/services/sales/sale.service";

export const metadata: Metadata = {
  title: "Expenses",
};

// Same reason as every other admin/ops page in this app — a newly
// recorded expense or category change must show up immediately.
export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const [categories, allCategories, paymentMethods, expenses] = await Promise.all([
    expenseCategoryService.listCategories(false),
    expenseCategoryService.listCategories(true),
    saleService.listPaymentMethods(),
    expenseService.listRecentExpenses(50),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <p className="text-muted-foreground text-sm">
          Money going out — rent, supplies, utilities, and anything else paid by the business.
        </p>
      </div>

      <ExpenseEntryForm categories={categories} paymentMethods={paymentMethods} />

      <Card>
        <CardHeader>
          <CardTitle>Recent expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpensesTable expenses={expenses} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Categories</h2>
        <ExpenseCategoryPanel categories={allCategories} />
      </div>
    </div>
  );
}
