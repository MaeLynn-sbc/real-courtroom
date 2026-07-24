import { Badge } from "@/components/ui/badge";
import type { BookingSource } from "@/lib/generated/prisma/enums";

const SOURCE_LABELS: Record<BookingSource, string> = {
  PUBLIC: "Public",
  STAFF: "Staff",
  UNKNOWN: "Unknown",
};

// UNKNOWN renders as its own visible state, never silently as PUBLIC or
// STAFF — it means the historical backfill couldn't determine this row's
// origin (see scripts/backfill-booking-source.ts), and that's worth
// surfacing, not hiding.
const SOURCE_VARIANTS: Record<BookingSource, "secondary" | "outline" | "warning"> = {
  PUBLIC: "secondary",
  STAFF: "outline",
  UNKNOWN: "warning",
};

export function BookingSourceBadge({ source }: { source: BookingSource }) {
  return <Badge variant={SOURCE_VARIANTS[source]}>{SOURCE_LABELS[source]}</Badge>;
}
