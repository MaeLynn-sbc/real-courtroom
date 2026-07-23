import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SessionStatusBadge } from "@/features/open-play/components/session-status-badge";
import type { openPlaySessionService } from "@/services/open-play/session.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Sessions = Awaited<ReturnType<typeof openPlaySessionService.listSessions>>;

interface SessionListProps {
  sessions: Sessions;
}

export function SessionList({ sessions }: SessionListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Capacity</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell>
              <Link href={`/dashboard/open-play/${session.id}`} className="font-medium hover:underline">
                {session.sessionReference}
              </Link>
            </TableCell>
            <TableCell>{session.title ?? "—"}</TableCell>
            <TableCell>
              {dateTimeFormatter.format(session.startAt)} – {dateTimeFormatter.format(session.endAt)}
            </TableCell>
            <TableCell>{session.capacity}</TableCell>
            <TableCell>
              <SessionStatusBadge status={session.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
