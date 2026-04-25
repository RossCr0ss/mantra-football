'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LEAGUES, fetchMatchOddsClient } from '@/lib/fotmob';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import { ProgressBar } from '@/components/LoadingProgressBar';
import type { TeamFixture, FixtureOdds } from '@/lib/fotmob';
import type { SquadPlayer } from '@/types/squad';

// ─── Difficulty ───────────────────────────────────────────────────────────────

const DIFFICULTY_STYLE: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-red-600',    text: 'text-red-100',    label: 'Very Hard' },
  2: { bg: 'bg-orange-500', text: 'text-orange-950', label: 'Hard'      },
  3: { bg: 'bg-yellow-500', text: 'text-yellow-950', label: 'Medium'    },
  4: { bg: 'bg-green-500',  text: 'text-green-950',  label: 'Easy'      },
  5: { bg: 'bg-green-700',  text: 'text-green-100',  label: 'Very Easy' },
};

function diffStyle(d: number | null) {
  if (d === null) return { bg: 'bg-gray-700', text: 'text-gray-300', label: '?' };
  return DIFFICULTY_STYLE[d] ?? DIFFICULTY_STYLE[3];
}

// ─── Odds helpers ─────────────────────────────────────────────────────────────

/** Returns odds from the perspective of the squad's team: win / draw / loss */
function teamOdds(odds: FixtureOdds, isHome: boolean) {
  return {
    win:  isHome ? odds.home  : odds.away,
    draw: odds.draw,
    loss: isHome ? odds.away  : odds.home,
  };
}

function winPct(odds: FixtureOdds, isHome: boolean): number | null {
  const w = isHome ? odds.home : odds.away;
  if (!w || w <= 1) return null;
  return Math.round((1 / w) * 100);
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatAge(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmt(n: number | null | undefined): string {
  return n != null ? n.toFixed(2) : '—';
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-gray-700 shrink-0" />
        <div className="h-4 w-32 rounded bg-gray-700" />
        <div className="ml-auto h-4 w-20 rounded bg-gray-800" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-3 w-48 rounded bg-gray-800" />
        <div className="ml-auto h-7 w-28 rounded-lg bg-gray-700" />
      </div>
    </div>
  );
}

function FixturesSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

// ─── Odds pill ────────────────────────────────────────────────────────────────

function OddsDisplay({ fix, odds }: { fix: TeamFixture; odds: FixtureOdds }) {
  const o = teamOdds(odds, fix.isHome);
  const pct = winPct(odds, fix.isHome);

  // Highlight the most likely outcome (lowest decimal odds)
  const values = [o.win, o.draw, o.loss].filter((v): v is number => v != null && v > 1);
  const minOdds = values.length ? Math.min(...values) : null;
  const isLikelyWin  = o.win  != null && o.win  === minOdds;
  const isLikelyDraw = o.draw != null && o.draw === minOdds;
  const isLikelyLoss = o.loss != null && o.loss === minOdds;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-stretch gap-px overflow-hidden rounded-lg border border-white/10 text-xs tabular-nums">
        {/* Win */}
        <div className={`flex flex-col items-center px-2.5 py-1.5 ${isLikelyWin ? 'bg-emerald-700/60' : 'bg-gray-800'}`}>
          <span className="text-gray-400 text-[10px] font-semibold uppercase tracking-wide">W</span>
          <span className={`font-bold ${isLikelyWin ? 'text-emerald-300' : 'text-white'}`}>{fmt(o.win)}</span>
        </div>
        {/* Draw */}
        <div className={`flex flex-col items-center px-2.5 py-1.5 ${isLikelyDraw ? 'bg-yellow-700/50' : 'bg-gray-800'}`}>
          <span className="text-gray-400 text-[10px] font-semibold uppercase tracking-wide">D</span>
          <span className={`font-bold ${isLikelyDraw ? 'text-yellow-300' : 'text-white'}`}>{fmt(o.draw)}</span>
        </div>
        {/* Loss */}
        <div className={`flex flex-col items-center px-2.5 py-1.5 ${isLikelyLoss ? 'bg-red-700/50' : 'bg-gray-800'}`}>
          <span className="text-gray-400 text-[10px] font-semibold uppercase tracking-wide">L</span>
          <span className={`font-bold ${isLikelyLoss ? 'text-red-300' : 'text-white'}`}>{fmt(o.loss)}</span>
        </div>
      </div>
      {pct !== null && (
        <div className="flex w-full items-center gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500/70"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{pct}% win</span>
        </div>
      )}
    </div>
  );
}

// ─── Fixture card ─────────────────────────────────────────────────────────────

function FixtureCard({
  team,
  fix,
  oddsState,
}: {
  team: { teamId: number; teamName: string; players: SquadPlayer[] };
  fix: TeamFixture | undefined;
  /** undefined = still loading, null = loaded but no odds */
  oddsState: FixtureOdds | null | undefined;
}) {
  const teamLogoUrl = `https://images.fotmob.com/image_resources/logo/teamlogo/${team.teamId}.png`;
  const ds = fix ? diffStyle(fix.difficulty) : null;
  const playerNames = team.players.map((p) => p.name.split(' ').slice(-1)[0]).join(', ');

  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 px-4 py-3.5 transition hover:bg-gray-800/50">
      <div className="flex items-start gap-3">

        {/* Left: team + fixture */}
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          {/* Team row */}
          <div className="flex items-center gap-2.5">
            <div className="relative h-7 w-7 shrink-0">
              <Image src={teamLogoUrl} alt={team.teamName} fill className="object-contain" unoptimized />
            </div>
            <p className="truncate text-sm font-semibold text-white">{team.teamName}</p>
            {playerNames && (
              <p className="ml-1 truncate text-xs text-gray-600 hidden sm:block">{playerNames}</p>
            )}
          </div>

          {/* Fixture row */}
          {fix ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {/* H / A */}
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                fix.isHome ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700/80 text-gray-300'
              }`}>
                {fix.isHome ? 'HOME' : 'AWAY'}
              </span>

              {/* vs opponent */}
              <div className="flex items-center gap-1.5">
                <div className="relative h-5 w-5 shrink-0">
                  <Image src={fix.opponent.logoUrl} alt={fix.opponent.name} fill className="object-contain" unoptimized />
                </div>
                <span className="text-white">{fix.opponent.name}</span>
              </div>

              {/* Date + round */}
              <span className="text-xs text-gray-500 shrink-0">{formatDate(fix.date)}</span>
              {fix.round && (
                <span className="text-xs text-gray-700 shrink-0">· R{fix.round}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No upcoming fixture</p>
          )}
        </div>

        {/* Right: difficulty + odds */}
        {fix && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            {/* Difficulty */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">{ds?.label}</span>
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold ${ds?.bg} ${ds?.text}`}>
                {fix.difficulty ?? '?'}
              </div>
            </div>

            {/* Odds */}
            {oddsState === undefined ? (
              /* Still loading */
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-transparent" />
                <span>Loading odds…</span>
              </div>
            ) : oddsState === null ? (
              <span className="text-xs text-gray-700">No odds available</span>
            ) : (
              <OddsDisplay fix={fix} odds={oddsState} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FixturesPage() {
  const params = useParams<{ id: string }>();
  const leagueId = Number(params.id);
  const league = LEAGUES.find((l) => l.id === leagueId);

  const [fixtures, setFixtures] = useState<Record<number, TeamFixture[]>>({});
  const [squad, setSquad] = useState<SquadPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [currentRound, setCurrentRound] = useState<string | null>(null);
  /** undefined = loading, null = loaded but no odds */
  const [oddsMap, setOddsMap] = useState<Record<string, FixtureOdds | null | undefined>>({});

  useEffect(() => {
    Promise.all([
      fetch(`/api/leagues/${leagueId}/fixtures`).then((r) => r.json()),
      fetch(`/api/squad?leagueId=${leagueId}`).then((r) => r.json()),
    ]).then(([fixtureData, squadData]) => {
      const loadedFixtures: Record<number, TeamFixture[]> = fixtureData.fixtures ?? {};
      setFixtures(loadedFixtures);
      setCachedAt(fixtureData.cachedAt ? new Date(fixtureData.cachedAt) : null);
      setCurrentRound(fixtureData.currentRound ?? null);
      setSquad(squadData.players ?? []);

      const uniqueMatchIds = Array.from(
        new Set(Object.values(loadedFixtures).flat().map((f) => f.matchId)),
      );

      // Pre-mark all as loading (undefined)
      setOddsMap(Object.fromEntries(uniqueMatchIds.map((id) => [id, undefined])));

      // Fetch each match's odds individually so cards update as they arrive
      uniqueMatchIds.forEach((id) => {
        fetchMatchOddsClient(id).then((odds) => {
          setOddsMap((prev) => ({ ...prev, [id]: odds ?? null }));
        });
      });
    }).finally(() => setLoading(false));
  }, [leagueId]);

  const teamMap = new Map<number, { teamId: number; teamName: string; players: SquadPlayer[] }>();
  for (const p of squad) {
    if (!teamMap.has(p.teamId)) {
      teamMap.set(p.teamId, { teamId: p.teamId, teamName: p.teamName, players: [] });
    }
    teamMap.get(p.teamId)!.players.push(p);
  }
  const teams = Array.from(teamMap.values()).sort((a, b) => a.teamName.localeCompare(b.teamName));

  return (
    <>
    <ProgressBar loading={loading} />
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="w-full max-w-4xl">
        <Breadcrumbs />

        {/* Header */}
        <div className="mt-6 mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            {league && (
              <div className="relative h-10 w-10 shrink-0">
                <Image src={league.logoUrl} alt={league.name} fill className="object-contain" unoptimized />
              </div>
            )}
            <div>
              <p className="text-sm text-gray-400">
                {league?.country}{currentRound ? ` · Round ${currentRound}` : ''}
              </p>
              <h1 className="text-2xl font-bold text-white">Next Fixtures</h1>
            </div>
          </div>
          {cachedAt && (
            <span className="text-xs text-gray-600" title={cachedAt.toISOString()}>
              Updated {formatAge(cachedAt)}
            </span>
          )}
        </div>

        <LeagueNav leagueId={leagueId} />

        {/* Difficulty legend */}
        <div className="mt-6 mb-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Difficulty:</span>
          {([1, 2, 3, 4, 5] as const).map((d) => {
            const s = diffStyle(d);
            return (
              <span key={d} className={`rounded px-2 py-0.5 text-xs font-bold ${s.bg} ${s.text}`}>
                {d} — {s.label}
              </span>
            );
          })}
          <span className="ml-auto text-xs text-gray-600">Odds: W / D / L from your team&apos;s view</span>
        </div>

        {loading ? (
          <FixturesSkeleton />
        ) : teams.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-gray-900 px-8 py-16 text-center">
            <p className="text-gray-400">No squad saved yet.</p>
            <Link
              href={`/league/${leagueId}`}
              className="mt-4 inline-block rounded-xl bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20"
            >
              Build Squad
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map((team) => {
              const fix: TeamFixture | undefined = (fixtures[team.teamId] ?? [])[0];
              const oddsState = fix ? oddsMap[fix.matchId] : undefined;
              return (
                <FixtureCard
                  key={team.teamId}
                  team={team}
                  fix={fix}
                  oddsState={oddsState}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
    </>
  );
}
