import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AttendanceSummary } from "@/features/open-play/components/attendance-summary";
import { QueueStatsBar } from "@/features/open-play/components/queue-stats-bar";
import { RegistrationForm } from "@/features/open-play/components/registration-form";
import { RegistrationList } from "@/features/open-play/components/registration-list";
import { RotationBoard } from "@/features/open-play/components/rotation-board";
import { SessionStatusActions } from "@/features/open-play/components/session-status-actions";
import { SessionStatusBadge } from "@/features/open-play/components/session-status-badge";
import { StartMatchButton } from "@/features/open-play/components/start-match-button";
import { playerService } from "@/services/player/player.service";
import { rotationEngine } from "@/services/open-play/rotation-engine";
import { openPlaySessionService } from "@/services/open-play/session.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface OpenPlaySessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export async function generateMetadata({ params }: OpenPlaySessionPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const session = await openPlaySessionService.getSessionById(sessionId);
  return { title: session?.sessionReference ?? "Open Play Session" };
}

export default async function OpenPlaySessionPage({ params }: OpenPlaySessionPageProps) {
  const { sessionId } = await params;

  const session = await openPlaySessionService.getSessionById(sessionId);
  if (!session) {
    notFound();
  }

  const [rotationView, stats, attendance, players] = await Promise.all([
    rotationEngine.getRotationView(sessionId),
    rotationEngine.getQueueStats(sessionId),
    openPlaySessionService.getAttendance(sessionId),
    playerService.listPlayers(),
  ]);

  const playerOptions = players.map((player) => ({
    id: player.id,
    label: player.user.name ?? player.user.email ?? "Unknown player",
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{session.sessionReference}</h1>
          <p className="text-muted-foreground text-sm">
            {session.title ? `${session.title} · ` : ""}
            {dateTimeFormatter.format(session.startAt)} – {dateTimeFormatter.format(session.endAt)}
            {" · "}Capacity {session.capacity}
          </p>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Status</h2>
        <SessionStatusActions sessionId={session.id} currentStatus={session.status} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Live queue</h2>
        <QueueStatsBar stats={stats} />
        <StartMatchButton sessionId={session.id} />
        <RotationBoard sessionId={session.id} rotationView={rotationView} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Registrations</h2>
          <RegistrationList sessionId={session.id} registrations={session.registrations} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Register</h2>
          <RegistrationForm sessionId={session.id} players={playerOptions} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Attendance</h2>
        <AttendanceSummary attendance={attendance} />
      </section>
    </div>
  );
}
