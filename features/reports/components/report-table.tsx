import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ReportTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface ReportTableProps<T> {
  rows: T[];
  columns: ReportTableColumn<T>[];
  getRowKey: (row: T) => string;
  // Optional totals row, one cell per column, in the same order. Takes
  // every row so a report that needs a month total can compute it from
  // exactly what is on screen. Return null to render no footer.
  renderFooter?: (rows: T[]) => ReactNode[] | null;
}

export function ReportTable<T>({ rows, columns, getRowKey, renderFooter }: ReportTableProps<T>) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No data in this date range.</p>;
  }

  const footerCells = renderFooter?.(rows) ?? null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.header} className="whitespace-nowrap">
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={getRowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.header} className="whitespace-nowrap">
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footerCells ? (
        <TableFooter>
          <TableRow>
            {columns.map((column, index) => (
              <TableCell key={column.header} className="font-semibold whitespace-nowrap">
                {footerCells[index] ?? null}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}
