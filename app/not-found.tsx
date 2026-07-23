import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground max-w-md text-sm text-balance">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>
      <Link href="/" className={buttonVariants()}>
        Back to home
      </Link>
    </div>
  );
}
