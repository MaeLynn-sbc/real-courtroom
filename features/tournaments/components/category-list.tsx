import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { tournamentService } from "@/services/tournaments/tournament.service";

type TournamentWithCategories = NonNullable<
  Awaited<ReturnType<typeof tournamentService.getTournamentById>>
>;
type Categories = TournamentWithCategories["categories"];

const FORMAT_LABELS: Record<string, string> = {
  ROUND_ROBIN: "Round Robin",
  SINGLE_ELIMINATION: "Single Elimination",
  DOUBLE_ELIMINATION: "Double Elimination",
  POOL_PLAY: "Pool Play",
};

const DIVISION_LABELS: Record<string, string> = {
  MENS: "Men's",
  WOMENS: "Women's",
  MIXED: "Mixed",
  OPEN: "Open",
};

interface CategoryListProps {
  tournamentId: string;
  categories: Categories;
}

export function CategoryList({ tournamentId, categories }: CategoryListProps) {
  if (categories.length === 0) {
    return <EmptyState title="No categories yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Division</TableHead>
          <TableHead>Format</TableHead>
          <TableHead>Teams</TableHead>
          <TableHead>Bracket</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category) => (
          <TableRow key={category.id}>
            <TableCell>
              <Link
                href={`/dashboard/tournaments/${tournamentId}/categories/${category.id}`}
                className="font-medium hover:underline"
              >
                {category.name}
              </Link>
            </TableCell>
            <TableCell>{DIVISION_LABELS[category.division] ?? category.division}</TableCell>
            <TableCell>{FORMAT_LABELS[category.format] ?? category.format}</TableCell>
            <TableCell>
              {category._count.registrations}
              {category.maxTeams ? ` / ${category.maxTeams}` : ""}
            </TableCell>
            <TableCell>
              {category._count.matches > 0 ? (
                <Badge variant="success">Generated</Badge>
              ) : (
                <Badge variant="outline">Not generated</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
