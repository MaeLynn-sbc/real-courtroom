import { Card, CardContent } from "@/components/ui/card";
import type { OpenPlayRegistrationStatus } from "@/lib/generated/prisma/enums";
import type { openPlaySessionService } from "@/services/open-play/session.service";

type Attendance = Awaited<ReturnType<typeof openPlaySessionService.getAttendance>>;

const SUMMARY_LABELS: Record<OpenPlayRegistrationStatus, string> = {
  REGISTERED: "Registered",
  WAITLISTED: "Waitlisted",
  CHECKED_IN: "Checked In",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

function summarize(attendance: Attendance): Record<OpenPlayRegistrationStatus, number> {
  const counts: Record<OpenPlayRegistrationStatus, number> = {
    REGISTERED: 0,
    WAITLISTED: 0,
    CHECKED_IN: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };

  for (const registration of attendance) {
    counts[registration.status] += 1;
  }

  return counts;
}

export function AttendanceSummary({ attendance }: { attendance: Attendance }) {
  const counts = summarize(attendance);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {(Object.keys(SUMMARY_LABELS) as OpenPlayRegistrationStatus[]).map((status) => (
        <Card key={status} size="sm">
          <CardContent className="flex flex-col items-center gap-1 py-1 text-center">
            <span className="text-xl font-semibold tabular-nums">{counts[status]}</span>
            <span className="text-muted-foreground text-xs">{SUMMARY_LABELS[status]}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
