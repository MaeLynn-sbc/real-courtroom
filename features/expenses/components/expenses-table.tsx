import { EmptyState } from "@/components/shared/empty-state";
import { ExpensePaymentMethodCell } from "@/features/expenses/components/expense-payment-method-cell";
import { VoidExpenseButton } from "@/features/expenses/components/void-expense-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { expenseService } from "@/services/expenses/expense.service";

type Expenses = Awaited<ReturnType<typeof expenseService.listRecentExpenses>>;

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface ExpensesTableProps {
  // Needed only so the payment-method cell can offer the alternatives.
  // Already loaded by the expenses page for the entry form above.
  paymentMethods: { id: string; label: string }[];
  expenses: Expenses;
}

export function ExpensesTable({ expenses, paymentMethods }: ExpensesTableProps) {
  if (expenses.length === 0) {
    return <EmptyState title="No expenses recorded yet." description="Record one above to get started." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Expense #</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Payment method</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Recorded by</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead>
            <span className="sr-only">Reverse</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {expenses.map((expense) => (
          // A reversed expense stays visible, struck through, rather than
          // vanishing: "where did that payout go" has to be answerable
          // from this screen. It no longer counts in any total.
          <TableRow key={expense.id} className={expense.voidedAt ? "text-muted-foreground" : ""}>
            <TableCell className="font-medium">{expense.expenseNumber}</TableCell>
            <TableCell>{dateFormatter.format(expense.date)}</TableCell>
            <TableCell className="max-w-64 truncate">
              <span className={expense.voidedAt ? "line-through" : ""}>{expense.description}</span>
              {expense.voidedAt ? (
                <span className="text-destructive block text-xs">
                  Reversed
                  {expense.voidedByEmployee
                    ? ` by ${expense.voidedByEmployee.firstName} ${expense.voidedByEmployee.lastName}`
                    : ""}
                  {expense.voidReason ? ` — ${expense.voidReason}` : ""}
                </span>
              ) : null}
            </TableCell>
            <TableCell>{expense.category.name}</TableCell>
            <TableCell>
              <ExpensePaymentMethodCell
                expenseId={expense.id}
                paymentMethodId={expense.paymentMethodId}
                paymentMethods={paymentMethods}
              />
            </TableCell>
            <TableCell className={expense.voidedAt ? "line-through" : ""}>
              {formatCurrency(expense.amountCents)}
            </TableCell>
            <TableCell>
              {expense.recordedByEmployee.firstName} {expense.recordedByEmployee.lastName}
            </TableCell>
            <TableCell>
              {expense.receiptStorageKey ? (
                <a
                  href={`/api/expense-receipt/${encodeURIComponent(expense.receiptStorageKey)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  View
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {expense.voidedAt ? null : (
                <VoidExpenseButton
                  expenseId={expense.id}
                  amountCents={expense.amountCents}
                  description={expense.description}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
