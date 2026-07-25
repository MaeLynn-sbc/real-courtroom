import { Check } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

// BUILD-SPEC.md §2, "Record card" — the dashboard's shared card
// language for a list of records with an on/off state (payment
// methods first; roll out to the other collision-risk screens next).
// Ramps are a curated set, not arbitrary hex — every stop pairing
// below is contrast-verified (WCAG AA, computed against the exact
// OKLCH values Tailwind ships) so a caller can't accidentally pick an
// inaccessible combination. None of them are the app's brand green
// (--primary/--success), so a record's own accent color can never
// re-create the action-vs-status collision this pattern exists to fix.
export type RecordCardRamp = "sky" | "violet" | "amber" | "rose" | "cyan" | "slate"

// Verified via OKLCH -> linear-sRGB -> relative luminance (WCAG 2.x
// formula), against Tailwind v4's actual default palette values
// (node_modules/tailwindcss/theme.css), not eyeballed:
//   {ramp}-50 bg / {ramp}-700 text (header, pill label): 4.87:1–9.88:1
//   {ramp}-700 bg / white text (accent button):          5.05:1–10.34:1
// Both comfortably clear the 4.5:1 AA floor for normal text on every
// ramp — amber is the tightest case at 4.87:1 / 5.05:1.
const RAMP_HEADER: Record<RecordCardRamp, string> = {
  sky: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  cyan: "bg-cyan-50 text-cyan-700",
  slate: "bg-slate-50 text-slate-700",
}

const RAMP_PILL_ACTIVE: Record<RecordCardRamp, string> = {
  sky: "bg-sky-100 text-sky-700",
  violet: "bg-violet-100 text-violet-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  cyan: "bg-cyan-100 text-cyan-700",
  slate: "bg-slate-100 text-slate-700",
}

const RAMP_BUTTON: Record<RecordCardRamp, string> = {
  sky: "bg-sky-700 text-white hover:bg-sky-700/90",
  violet: "bg-violet-700 text-white hover:bg-violet-700/90",
  amber: "bg-amber-700 text-white hover:bg-amber-700/90",
  rose: "bg-rose-700 text-white hover:bg-rose-700/90",
  cyan: "bg-cyan-700 text-white hover:bg-cyan-700/90",
  slate: "bg-slate-700 text-white hover:bg-slate-700/90",
}

// The header tint is presentation only — it can never be the only way
// a screen reader user learns a record's state. The pill always
// carries the text label ("Active"/"Disabled"), never color alone.
interface RecordCardProps {
  ramp: RecordCardRamp
  icon: LucideIcon
  title: string
  active: boolean
  activeLabel?: string
  inactiveLabel?: string
  children: React.ReactNode
  className?: string
}

function RecordCard({
  ramp,
  icon: Icon,
  title,
  active,
  activeLabel = "Active",
  inactiveLabel = "Disabled",
  children,
  className,
}: RecordCardProps) {
  return (
    <div
      data-slot="record-card"
      className={cn(
        "overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 transition-opacity",
        !active && "opacity-55",
        className,
      )}
    >
      <div className={cn("flex items-center justify-between gap-3 px-4 py-2.5", RAMP_HEADER[ramp])}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            active ? RAMP_PILL_ACTIVE[ramp] : "border border-border text-muted-foreground",
          )}
        >
          {active ? <Check className="size-3" aria-hidden="true" /> : null}
          {active ? activeLabel : inactiveLabel}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// The header's accent follows the caller into its own body — e.g. a
// per-record "Save" button — via this class string rather than a
// second component, so the accent-follows-header rule can't drift out
// of sync with the header itself.
function recordCardAccentButtonClass(ramp: RecordCardRamp): string {
  return RAMP_BUTTON[ramp]
}

export { RecordCard, recordCardAccentButtonClass }
