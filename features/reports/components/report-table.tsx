import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ReportTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface ReportTableProps<T> {
  rows: T[];
  columns: ReportTableColumn<T>[];
  getRowKey: (row: T) => string;
}

export function ReportTable<T>({ rows, columns, getRowKey }: ReportTableProps<T>) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No data in this date range.</p>;
  }

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
    </Table>
  );
}
