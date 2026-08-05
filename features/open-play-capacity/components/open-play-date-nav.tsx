"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface OpenPlayDateNavProps {
  dateValue: string;
  prevDateValue: string;
  nextDateValue: string;
}

// Incident (reported live, ~12:06 AM): staff reach this page every day via
// a fixed "Regular Open Play" nav link that always redirects to the
// server's current calendar date (today/page.tsx) — right after midnight,
// that's a brand-new empty day, and the previous night's still-open tabs
// became unreachable except by hand-editing the URL. This is the fix:
// every date this page can already render (the [date] route already
// worked for any date, that part was never broken) is now one click away
// instead of a URL edit. Deliberately no date-logic change anywhere near
// this — same calendar-date route, just a visible way to reach it.
export function OpenPlayDateNav({ dateValue, prevDateValue, nextDateValue }: OpenPlayDateNavProps) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/dashboard/admin/open-play-capacity/${prevDateValue}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        ← Prev day
      </Link>
      <Link
        href={`/dashboard/admin/open-play-capacity/${nextDateValue}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        Next day →
      </Link>
      <Input
        type="date"
        value={dateValue}
        onChange={(event) => {
          if (event.target.value) {
            router.push(`/dashboard/admin/open-play-capacity/${event.target.value}`);
          }
        }}
        className="h-8 w-auto"
        aria-label="Jump to date"
      />
    </div>
  );
}
