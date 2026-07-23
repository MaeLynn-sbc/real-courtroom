import { Skeleton } from "@/components/ui/skeleton";

interface LoadingSkeletonProps {
  rows?: number;
}

export function LoadingSkeleton({ rows = 3 }: LoadingSkeletonProps) {
  return (
    <div className="flex flex-col gap-3 p-6">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}
