export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { notFound } from 'next/navigation';
import { LEAGUES } from '@/lib/fotmob';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import { getPlayerInjuriesBatch } from '@/lib/injuries';
import { getDb } from '@/lib/mongodb';
import InjuryReportView from '@/components/InjuryReportView';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import type { Squad, SquadPlayer } from '@/types/squad';

interface Props {
  params: { id: string };
}

export default async function InjuriesPage({ params }: Props) {
  const league = LEAGUES.find((l) => l.id === Number(params.id));
  if (!league) notFound();

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId: league.id });
  const players: SquadPlayer[] = (saved?.players ?? []).map((p) => ({
    ...p,
    mantraPositions: p.mantraPositions ?? [],
  }));

  const injuryMap = await getPlayerInjuriesBatch(players);
  const injuries: Record<number, PlayerInjuryInfo> = {};
  for (const [idStr, info] of Object.entries(injuryMap)) {
    if (info) injuries[Number(idStr)] = info;
  }

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl space-y-6">
        <Breadcrumbs />

        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0">
            <Image src={league.logoUrl} alt={league.name} fill className="object-contain" unoptimized />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">{league.country}</p>
            <h1 className="text-xl font-bold text-white">{league.name}</h1>
          </div>
        </div>

        <LeagueNav leagueId={league.id} />

        <InjuryReportView
          leagueId={league.id}
          initialPlayers={players}
          initialInjuries={injuries}
        />
      </div>
    </main>
  );
}
