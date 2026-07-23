import Link from "next/link";

import { siteConfig } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 px-6 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        {siteConfig.name}
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
