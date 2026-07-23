"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  cancelRegistrationAction,
  checkInRegistrationAction,
  markNoShowAction,
} from "@/actions/open-play.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OpenPlayRegistrationStatus } from "@/lib/generated/prisma/enums";
import type { openPlaySessionService } from "@/services/open-play/session.service";

type SessionWithRegistrations = NonNullable<
  Awaited<ReturnType<typeof openPlaySessionService.getSessionById>>
>;
type Registrations = SessionWithRegistrations["registrations"];

const STATUS_LABELS: Record<OpenPlayRegistrationStatus, string> = {
  REGISTERED: "Registered",
  WAITLISTED: "Waitlisted",
  CHECKED_IN: "Checked In",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const STATUS_VARIANTS: Record<OpenPlayRegistrationStatus, "success" | "outline" | "destructive"> = {
  REGISTERED: "success",
  WAITLISTED: "outline",
  CHECKED_IN: "success",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

interface RegistrationListProps {
  sessionId: string;
  registrations: Registrations;
}

export function RegistrationList({ sessionId, registrations }: RegistrationListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleAction(action: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (registrations.length === 0) {
    return <EmptyState title="No registrations yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registrations.map((registration) => {
          const name =
            registration.player?.user.name ??
            registration.player?.user.email ??
            registration.guestName ??
            "—";

          return (
            <TableRow key={registration.id}>
              <TableCell>{name}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[registration.status]}>
                  {STATUS_LABELS[registration.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {registration.status === "REGISTERED" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        handleAction(() => checkInRegistrationAction(sessionId, registration.id))
                      }
                    >
                      Check in
                    </Button>
                  ) : null}
                  {registration.status === "REGISTERED" ||
                  registration.status === "WAITLISTED" ||
                  registration.status === "CHECKED_IN" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() =>
                        handleAction(() => cancelRegistrationAction(sessionId, registration.id))
                      }
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {registration.status === "REGISTERED" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleAction(() => markNoShowAction(sessionId, registration.id))}
                    >
                      No-show
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
