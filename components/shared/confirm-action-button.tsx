"use client";

import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmActionButtonProps {
  onConfirm: () => void;
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
  className?: string;
}

// Wraps a trigger button in a confirm step before firing a destructive
// action — the app had no confirmation step anywhere before Phase 10;
// destructive actions (delete, mark lost, cancel) fired immediately on
// click. One shared component so every call site gets the same behavior
// (Escape/backdrop-click cancels, focus returns to the trigger on close —
// both handled by Base UI's Dialog primitives underneath AlertDialog, the
// same as the app's existing Sheet).
export function ConfirmActionButton({
  onConfirm,
  children,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  size = "sm",
  disabled,
  className,
}: ConfirmActionButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button type="button" variant={variant} size={size} disabled={disabled} className={className} />
        }
      >
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
