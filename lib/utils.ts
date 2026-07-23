import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(cents: number, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(cents / 100)
}
