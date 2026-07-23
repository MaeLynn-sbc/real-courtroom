import Image from "next/image";

import { cn } from "@/lib/utils";

// v1.1 Sub-phase 5: the one place every logo render in the app goes
// through — sidebar, header, homepage. Centralizing here means a future
// branding refresh (swapping in logo-light.png/logo-dark.png once they
// exist) is a one-file change instead of hunting down every <Image>
// call site. Only public/branding/logo.png exists today; `variant` is
// already wired for when the light/dark-specific files are added — it
// currently resolves to the same source for both.
export interface LogoProps {
  size?: "sm" | "default" | "lg";
  showWordmark?: boolean;
  variant?: "auto" | "light" | "dark";
  className?: string;
}

const SIZE_PX: Record<NonNullable<LogoProps["size"]>, number> = {
  sm: 24,
  default: 32,
  lg: 48,
};

// Not yet swapped to logo-light.png/logo-dark.png (only logo.png ships
// today) — this is the single spot that changes once those exist.
function resolveLogoSrc(variant: LogoProps["variant"]): string {
  switch (variant) {
    case "light":
    case "dark":
    case "auto":
    default:
      return "/branding/logo.png";
  }
}

export function Logo({ size = "default", showWordmark = false, variant = "auto", className }: LogoProps) {
  const px = SIZE_PX[size];

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src={resolveLogoSrc(variant)}
        alt="The Courtroom"
        width={px}
        height={px}
        className="shrink-0 rounded-md object-contain"
        priority
      />
      {showWordmark ? (
        <span className="font-heading text-base leading-none font-semibold tracking-tight">
          The Courtroom
        </span>
      ) : null}
    </span>
  );
}
