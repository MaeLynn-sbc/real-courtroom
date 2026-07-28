"use client";

import { KeyRound, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-current-user";

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  return email?.slice(0, 2).toUpperCase() ?? "?";
}

export function UserNav() {
  const { user } = useCurrentUser();

  if (!user) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar className="size-8">
          <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium">{user.name ?? user.email}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {user.role ?? "Member"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Previously reachable only via the forced must-change-password
            redirect (lib/rbac.ts) — no voluntary entry point anywhere,
            same "screen exists but nothing links to it" gap as Coaching
            had. The page itself already handles both cases correctly
            (features/auth/components/change-password-form.tsx's `forced`
            prop only changes the description copy; submit always signs
            out and redirects to /login?passwordChanged=1, which shows a
            real confirmation message either way) — this was just the
            missing link. */}
        <DropdownMenuItem render={<Link href="/dashboard/change-password" />}>
          <KeyRound className="size-4" aria-hidden="true" />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut({ callbackUrl: "/" })}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
