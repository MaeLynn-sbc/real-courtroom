"use client";

import "./globals.css";

import { ErrorFallback } from "@/components/shared/error-fallback";

// Next.js convention: global-error.tsx replaces the entire root layout
// (including <html>/<body>) when an error escapes the root layout itself —
// app/error.tsx only catches errors below it. Deliberately does NOT reuse
// RootLayout's ThemeProvider/SessionProvider/QueryProvider — if the root
// layout crashed, one of those could be implicated, so this stays minimal
// and self-contained rather than risking a second failure while rendering
// the fallback.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback
          error={error}
          reset={reset}
          title="Something went seriously wrong"
          description="The application failed to load. Try reloading the page, and if the problem persists, contact support."
        />
      </body>
    </html>
  );
}
