"use client";

import { ErrorFallback } from "@/components/shared/error-fallback";

// Scoped to the /dashboard segment — Next.js renders this in place of
// {children} inside app/dashboard/layout.tsx, so the header/sidebar shell
// stays mounted instead of the whole app falling back to the root
// app/error.tsx (which would also blank out the nav).
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
