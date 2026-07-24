"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// Decorative live clock, not a business rule — the facility's overall
// daily window (matches the footer's "7:00 AM – 11:00 PM" copy), distinct
// from each court's individual booking cutoff (lib/court-hours.ts).
const OPEN_HOUR = 7;
const CLOSE_HOUR = 23;

export function SiteStatusPill() {
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    function update() {
      const hour = new Date().getHours();
      setIsOpen(hour >= OPEN_HOUR && hour < CLOSE_HOUR);
    }
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (isOpen === null) {
    return null;
  }

  return (
    <span
      className={cn(
        "border-line font-jetbrains hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-[0.14em] uppercase sm:flex",
        isOpen ? "text-bone" : "text-slate",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isOpen ? "bg-green motion-safe:animate-pulse" : "bg-slate",
        )}
        aria-hidden="true"
      />
      {isOpen ? "In session" : "Adjourned"}
    </span>
  );
}
