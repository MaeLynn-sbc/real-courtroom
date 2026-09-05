import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";

import { CategoryForm } from "@/features/tournaments/components/category-form";
import { CategoryList } from "@/features/tournaments/components/category-list";
import { TournamentLogoUpload } from "@/features/tournaments/components/tournament-logo-upload";
import { TournamentPaymentSettingToggle } from "@/features/tournaments/components/tournament-payment-setting-toggle";
import { TournamentSlugForm } from "@/features/tournaments/components/tournament-slug-form";
import { TournamentStatusActions } from "@/features/tournaments/components/tournament-status-actions";
import { TournamentStatusBadge } from "@/features/tournaments/components/tournament-status-badge";
import { tournamentService } from "@/services/tournaments/tournament.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface TournamentDetailPageProps {
  params: Promise<{ tournamentId: string }>;
}

export async function generateMetadata({ params }: TournamentDetailPageProps): Promise<Metadata> {
  const { tournamentId } = await params;
  const tournament = await tournamentService.getTournamentById(tournamentId);
  return { title: tournament?.name ?? "Tournament" };
}

export default async function TournamentDetailPage({ params }: TournamentDetailPageProps) {
  const { tournamentId } = await params;
  const tournament = await tournamentService.getTournamentById(tournamentId);

  if (!tournament) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tournament.name}</h1>
          <p className="text-muted-foreground text-sm">
            {dateFormatter.format(tournament.startDate)} – {dateFormatter.format(tournament.endDate)}
            {tournament.venueInfo ? ` · ${tournament.venueInfo}` : ""}
          </p>
          {tournament.description ? (
            <p className="text-muted-foreground mt-1 text-sm">{tournament.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <TournamentStatusBadge status={tournament.status} />
          <Link
            href={`/dashboard/tournaments/${tournamentId}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Edit
          </Link>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Status</h2>
        <TournamentStatusActions tournamentId={tournament.id} currentStatus={tournament.status} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Logo</h2>
        <p className="text-muted-foreground text-sm">
          Shown on /tourtv alongside The Courtroom&apos;s own logo.
        </p>
        <TournamentLogoUpload tournamentId={tournament.id} logoUrl={tournament.logoUrl} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Public page</h2>
        <p className="text-muted-foreground text-sm">
          The address the public bracket and standings live at.
        </p>
        <TournamentSlugForm tournamentId={tournament.id} slug={tournament.slug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Payment</h2>
        <TournamentPaymentSettingToggle
          tournamentId={tournament.id}
          collectsPaymentOnSite={tournament.collectsPaymentOnSite}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Categories</h2>
          <CategoryList tournamentId={tournament.id} categories={tournament.categories} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Add category</h2>
          <CategoryForm tournamentId={tournament.id} />
        </div>
      </section>
    </div>
  );
}
