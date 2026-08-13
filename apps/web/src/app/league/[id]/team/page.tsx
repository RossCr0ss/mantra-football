export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { LEAGUES } from '@/lib/fotmob';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import { getPlayerInjuriesBatch } from '@/lib/injuries';
import { getPlayerFormCached } from '@/lib/fotmobCache';
import { suggestAvailabilityPct, summarizeRecentForm } from '@/lib/availabilitySuggestion';
import { getSquadSeasonStats } from '@/lib/squadStats';
import { getDb } from '@/lib/mongodb';
import TeamSquadView, { type PlayerForm } from '@/components/TeamSquadView';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import type { Squad, SquadPlayer, PositionGroup } from '@/types/squad';
import type { PlayerSeasonStats } from '@/lib/fotmob';

interface Props {
  params: { id: string };
}

const POSITION_SECTIONS: { group: PositionGroup; label: string }[] = [
  { group: 'GK',  label: 'Goalkeepers' },
  { group: 'DEF', label: 'Defenders'   },
  { group: 'MID', label: 'Midfielders' },
  { group: 'FWD', label: 'Forwards'    },
];


export default async function TeamPage({ params }: Props) {
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

  const formEntries = await Promise.all(
    players.map(async (p) => {
      const matches = await getPlayerFormCached(p.id, league.id).catch(() => []);
      const form: PlayerForm = {
        matches,
        suggestedPct: suggestAvailabilityPct(matches),
        ...summarizeRecentForm(matches, p.positionGroup),
      };
      return [p.id, form] as const;
    }),
  );
  const initialForm: Record<number, PlayerForm> = Object.fromEntries(formEntries);

  const seasonStatsMap = await getSquadSeasonStats(league.id, players);
  const seasonStats: Record<number, PlayerSeasonStats> = Object.fromEntries(seasonStatsMap);

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl">
        <Breadcrumbs />

        {/* Header */}
        <div className="mt-6 mb-6 flex flex-wrap items-start gap-4">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 shrink-0">
              <Image src={league.logoUrl} alt={league.name} fill className="object-contain" unoptimized />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">{league.country}</p>
              <h1 className="text-xl font-bold text-white">{league.name}</h1>
            </div>
          </div>
        </div>

        <LeagueNav leagueId={league.id} />

        {players.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-20 text-center">
            <p className="text-2xl">⚽</p>
            <p className="mt-3 font-semibold text-white">No squad saved yet</p>
            <p className="mt-1 text-sm text-gray-500">Pick your 26 players to get started</p>
            <Link
              href={`/league/${league.id}`}
              className="mt-6 inline-block rounded-xl bg-green-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600"
            >
              Build Squad
            </Link>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="mb-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-6">
              <SummaryCell label="Total" value={players.length} />
              {POSITION_SECTIONS.map(({ group, label }) => (
                <SummaryCell
                  key={group}
                  label={label.replace(/s$/, '')}
                  value={players.filter((p) => p.positionGroup === group).length}
                />
              ))}
              <SummaryCell
                label="Injured"
                value={Object.keys(injuries).length}
                accent={Object.keys(injuries).length > 0 ? 'text-red-400' : undefined}
              />
            </div>

            <TeamSquadView
              leagueId={league.id}
              initialPlayers={players}
              injuries={injuries}
              primaryColor={league.primaryColor}
              initialForm={initialForm}
              seasonStats={seasonStats}
            />
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center bg-gray-900 px-3 py-4 text-center">
      <p className={`text-xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    </div>
  );
}
