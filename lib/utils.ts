import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(cents: number, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(cents / 100)
}

// Extracted from features/notifications/components/notification-bell.tsx,
// the first place this convention existed — reused rather than a second
// relative-time convention being invented for booking.createdAt.
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMinutes = Math.round(diffMs / 60_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}
