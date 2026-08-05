import Link from "next/link";

interface OpenTabsCarryoverBannerProps {
  dateValue: string;
  label: string;
}

// Shown only when today has zero PlayerTab rows AND the previous day still
// has an OPEN one — the exact shape of the midnight-rollover incident this
// was built for (reported live, ~12:06 AM): a session running past
// midnight left real open tabs sitting on a day nothing pointed at anymore.
// Same warning style as payment-methods-workspace.tsx's inline error banner.
export function OpenTabsCarryoverBanner({ dateValue, label }: OpenTabsCarryoverBannerProps) {
  return (
    <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <span>
        Yesterday&apos;s session still has open tabs —{" "}
        <Link href={`/dashboard/admin/open-play-capacity/${dateValue}`} className="font-medium underline">
          go to {label}
        </Link>
      </span>
    </div>
  );
}
