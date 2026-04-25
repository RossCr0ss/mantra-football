export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { LEAGUES } from '@/lib/fotmob';
import Breadcrumbs from '@/components/Breadcrumbs';
import { getDb } from '@/lib/mongodb';
import SquadManager from '@/components/SquadManager';
import type { Squad } from '@/types/squad';

interface Props {
  params: { id: string };
  searchParams: { edit?: string };
}

export default async function LeaguePage({ params, searchParams }: Props) {
  const league = LEAGUES.find((l) => l.id === Number(params.id));
  if (!league) notFound();

  const db = await getDb();
  const savedSquad = await db
    .collection<Squad>('squads')
    .findOne({ leagueId: league.id });

  if (savedSquad?.players?.length && !searchParams.edit) {
    redirect(`/league/${league.id}/team`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="w-full max-w-5xl">
        <Breadcrumbs />

        {/* League header */}
        <div className="mt-6 flex items-center gap-4">
          <div className="relative h-14 w-14 shrink-0">
            <Image
              src={league.logoUrl}
              alt={league.name}
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <div>
            <p className="text-sm text-gray-400">{league.country}</p>
            <h1 className="text-2xl font-bold text-white">{league.name}</h1>
          </div>
        </div>

        <SquadManager
          leagueId={league.id}
          initialPlayers={savedSquad?.players ?? []}
        />
      </div>
    </main>
  );
}
