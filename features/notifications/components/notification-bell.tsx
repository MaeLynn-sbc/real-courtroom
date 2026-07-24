"use client";

import { Bell } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  getNotificationCenterDataAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationCenterData,
} from "@/actions/notification.actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";

export function NotificationBell() {
  const [data, setData] = useState<NotificationCenterData | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadData() {
    startTransition(async () => {
      const result = await getNotificationCenterDataAction();
      setData(result);
    });
  }

  async function handleMarkRead(notificationId: string) {
    const result = await markNotificationReadAction(notificationId);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    loadData();
  }

  async function handleMarkAllRead() {
    const result = await markAllNotificationsReadAction();
    if (result.error) {
      toast.error(result.error);
      return;
    }
    loadData();
  }

  const unreadCount = data?.unreadCount ?? 0;

  // Reopening re-triggers loadData(), but without clearing `data` first the
  // popup would keep showing the previous open's (possibly now stale, e.g.
  // just-marked-read or newly-generated) list until the refetch resolves —
  // clearing it makes every open show a fresh "Loading..." state instead of
  // briefly rendering outdated data.
  function handleOpenChange(open: boolean) {
    if (open) {
      setData(null);
      loadData();
    }
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label="Notifications"
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full px-1 text-[10px]"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {isPending && !data ? (
          <div className="text-muted-foreground px-2 py-4 text-center text-sm">Loading...</div>
        ) : !data || data.notifications.length === 0 ? (
          <div className="text-muted-foreground px-2 py-4 text-center text-sm">
            You&apos;re all caught up.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {data.notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className="flex flex-col items-start gap-0.5 whitespace-normal"
                onClick={() => !notification.isRead && handleMarkRead(notification.id)}
              >
                <div className="flex w-full items-center gap-2">
                  {!notification.isRead ? (
                    <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                  ) : null}
                  <span className={notification.isRead ? "text-muted-foreground" : "font-medium"}>
                    {notification.title}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">{notification.body}</span>
                <span className="text-muted-foreground text-[11px]">
                  {formatRelativeTime(notification.createdAt)}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
