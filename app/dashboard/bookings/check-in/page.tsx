import type { Metadata } from "next";

import { CheckInLookupForm } from "@/features/bookings/components/check-in-lookup-form";

export const metadata: Metadata = {
  title: "Check In",
};

interface CheckInPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function CheckInPage({ searchParams }: CheckInPageProps) {
  const { token } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check in</h1>
        <p className="text-muted-foreground text-sm">
          Scan a booking&apos;s QR code, or paste its check-in code below.
        </p>
      </div>
      <CheckInLookupForm initialToken={token} />
    </div>
  );
}
