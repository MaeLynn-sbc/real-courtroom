import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Unauthorized",
};

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <ShieldAlert className="text-muted-foreground size-12" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground max-w-md text-sm text-balance">
        Your account doesn&apos;t have the permissions required to view this section. If you
        think this is a mistake, contact a facility manager.
      </p>
      <Link href="/dashboard" className={buttonVariants()}>
        Back to dashboard
      </Link>
    </div>
  );
}
