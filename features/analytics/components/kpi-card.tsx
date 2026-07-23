import { Card, CardContent } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: string | number;
}

export function KpiCard({ label, value }: KpiCardProps) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 py-1">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </CardContent>
    </Card>
  );
}
