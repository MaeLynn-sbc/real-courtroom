"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}

export function ErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  description = "An unexpected error occurred. You can try again, and if the problem persists, contact support.",
}: ErrorFallbackProps) {
  useEffect(() => {
    // lib/logger.ts (Pino) is server-only — client error boundaries report
    // to the browser console instead, same as Next.js's own error.tsx docs.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="text-destructive size-10" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground max-w-md text-sm text-balance">{description}</p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
