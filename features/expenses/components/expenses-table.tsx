import { EmptyState } from "@/components/shared/empty-state";
import { ExpensePaymentMethodCell } from "@/features/expenses/components/expense-payment-method-cell";
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {expenses.map((expense) => (
          <TableRow key={expense.id}>
            <TableCell className="font-medium">{expense.expenseNumber}</TableCell>
            <TableCell>{dateFormatter.format(expense.date)}</TableCell>
            <TableCell className="max-w-64 truncate">{expense.description}</TableCell>
            <TableCell>{expense.category.name}</TableCell>
            <TableCell>
              <ExpensePaymentMethodCell
                expenseId={expense.id}
                paymentMethodId={expense.paymentMethodId}
                paymentMethods={paymentMethods}
              />
            </TableCell>
            <TableCell>{formatCurrency(expense.amountCents)}</TableCell>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
