'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { LEAGUES } from '@/lib/leagues';
import type { PlayerRecentMatch } from '@/lib/fotmob';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';
import { fetchJsonCached, CACHE_KEY } from '@/lib/clientCache';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import { ProgressBar } from '@/components/LoadingProgressBar';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { RADAR_CONFIG, type SortKey, ratingColor } from '@/components/analytics/analyticsUi';
import { FormStrip } from '@/components/analytics/FormWidgets';
import { AnalyticsCard } from '@/components/analytics/AnalyticsCard';
import { AnalyticsSkeleton, EmptyState, SummaryCard } from '@/components/analytics/AnalyticsParts';

type PositionFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'FWD';
type ViewMode = 'table' | 'cards';

interface ColDef {
  key: SortKey;
  label: string;
  short: string;
  color?: string;
  forPositions: PositionFilter[];
}

const COLUMNS: ColDef[] = [
  { key: 'rating',            label: 'Rating',           short: 'Rtg',  forPositions: ['ALL','GK','DEF','MID','FWD'] },
  // GK-specific
  { key: 'cleanSheets',       label: 'Clean Sheets',     short: 'CS',   forPositions: ['ALL','GK','DEF'] },
  { key: 'saves',             label: 'Saves',            short: 'SV',   forPositions: ['GK'] },
  { key: 'goalsConceded',     label: 'Goals Conceded',   short: 'GC',   color: 'text-red-500',    forPositions: ['GK'] },
  { key: 'savePercentage',    label: 'Save %',           short: 'SV%',  forPositions: ['GK'] },
  { key: 'goalsPrevented',    label: 'Goals Prevented',  short: 'GP',   forPositions: ['GK'] },
  { key: 'penaltySaves',      label: 'Penalty Saves',    short: 'PSv',  forPositions: ['GK'] },
  // DEF
  { key: 'tackles',           label: 'Tackles',          short: 'Tk',   forPositions: ['ALL','DEF','MID'] },
  { key: 'interceptions',     label: 'Interceptions',    short: 'Int',  forPositions: ['ALL','DEF','MID'] },
  { key: 'clearances',        label: 'Clearances',       short: 'Clr',  forPositions: ['ALL','DEF'] },
  { key: 'blockedShots',      label: 'Blocked Shots',    short: 'Blk',  forPositions: ['DEF'] },
  { key: 'aerialsWon',        label: 'Aerials Won',      short: 'AW',   forPositions: ['DEF','FWD'] },
  // shared
  { key: 'goals',             label: 'Goals',            short: 'G',    forPositions: ['ALL','DEF','MID','FWD'] },
  { key: 'assists',           label: 'Assists',          short: 'A',    forPositions: ['ALL','DEF','MID','FWD'] },
  // MID/FWD
  { key: 'expectedGoals',     label: 'Expected Goals',   short: 'xG',   forPositions: ['ALL','MID','FWD'] },
  { key: 'shots',             label: 'Shots',            short: 'Sh',   forPositions: ['MID','FWD'] },
  { key: 'chancesCreated',    label: 'Key Passes',       short: 'KP',   forPositions: ['ALL','MID','FWD'] },
  { key: 'bigChancesCreated', label: 'Big Chances Created', short: 'BCC', forPositions: ['MID'] },
  { key: 'bigChancesMissed',  label: 'Big Chances Missed',  short: 'BCM', color: 'text-red-500', forPositions: ['FWD'] },
  { key: 'successfulDribbles',label: 'Dribbles',         short: 'Drb',  forPositions: ['MID','FWD'] },
  // common
  { key: 'matchesPlayed',     label: 'Matches Played',   short: 'MP',   color: 'text-gray-500', forPositions: ['ALL','GK','DEF','MID','FWD'] },
  { key: 'leagueRank',        label: 'League Rank',      short: 'Rank', color: 'text-gray-500', forPositions: ['ALL','GK','DEF','MID','FWD'] },
  { key: 'yellowCards',       label: 'Yellow Cards',     short: 'YC',   color: 'text-yellow-600', forPositions: ['ALL','DEF','MID','FWD'] },
  { key: 'redCards',          label: 'Red Cards',        short: 'RC',   color: 'text-red-700',    forPositions: ['ALL','DEF','MID','FWD'] },
];

const POS_FILTERS: PositionFilter[] = ['ALL', 'GK', 'DEF', 'MID', 'FWD'];

function statValue(player: PlayerAnalytics, key: SortKey): number | null {
  return (player[key as keyof PlayerAnalytics] as number | null) ?? null;
}

function formatStat(player: PlayerAnalytics, key: SortKey): string {
  const v = statValue(player, key);
  if (v === null) return '—';
  if (key === 'leagueRank')    return `#${v}`;
  if (key === 'expectedGoals') return v.toFixed(1);
  if (key === 'savePercentage') return `${v}%`;
  return String(v);
}

// ─── Client cache ─────────────────────────────────────────────────────────────

// ─── Form components ──────────────────────────────────────────────────────────

function useRelativeTime(iso: string | null): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!iso) { setLabel(''); return; }
    const update = () => {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diffMs / 60_000);
      if (mins < 1)       setLabel('just now');
      else if (mins < 60) setLabel(`${mins}m ago`);
      else                setLabel(`${Math.floor(mins / 60)}h ago`);
    };
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, [iso]);
  return label;
}

export default function AnalyticsPage() {
  const params = useParams<{ id: string }>();
  const leagueId = Number(params.id);
  const league = LEAGUES.find((l) => l.id === leagueId);

  const [players, setPlayers]           = useState<PlayerAnalytics[]>([]);
  const [form, setForm]                 = useState<Record<string, PlayerRecentMatch[]>>({});
  const [loading, setLoading]           = useState(true);
  const [loadingForm, setLoadingForm]   = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState<SortKey>('rating');
  const [posFilter, setPosFilter]       = useState<PositionFilter>('ALL');
  const [viewMode, setViewMode]         = useState<ViewMode>('cards');

  const updatedLabel = useRelativeTime(dataUpdatedAt);

  function loadData(refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true);
    setLoadingForm(true);

    fetchJsonCached<{ players?: PlayerAnalytics[]; dataUpdatedAt?: string | null }>(
      CACHE_KEY.analytics(leagueId), `/api/leagues/${leagueId}/analytics`, { refresh },
    )
      .then((d) => {
        setPlayers(d.players ?? []);
        setDataUpdatedAt(d.dataUpdatedAt ?? null);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });

    fetchJsonCached<{ form?: Record<string, PlayerRecentMatch[]> }>(
      CACHE_KEY.form(leagueId), `/api/leagues/${leagueId}/form`, { refresh },
    )
      .then((d) => setForm(d.form ?? {}))
      .catch(() => {})
      .finally(() => setLoadingForm(false));
  }

  useEffect(() => { loadData(); }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCols = useMemo(
    () => COLUMNS.filter((c) => c.forPositions.includes(posFilter)),
    [posFilter],
  );

  useEffect(() => {
    if (!visibleCols.find((c) => c.key === sortKey)) setSortKey('rating');
  }, [posFilter, visibleCols, sortKey]);

  function playerMatchesFilter(p: PlayerAnalytics, filter: PositionFilter): boolean {
    if (filter === 'ALL') return true;
    if (p.mantraPositions.length > 0) {
      return p.mantraPositions.some((mp) => {
        const def = MANTRA_POSITIONS.find((d) => d.code === mp);
        return def?.group === filter;
      });
    }
    return p.positionGroup === filter;
  }

  const sorted = useMemo(() => {
    let list = posFilter === 'ALL' ? players : players.filter((p) => playerMatchesFilter(p, posFilter));
    list = [...list].sort((a, b) => {
      if (sortKey === 'leagueRank')       return (a.leagueRank    ?? 9999) - (b.leagueRank    ?? 9999);
      if (sortKey === 'goalsConceded')    return (a.goalsConceded ?? 9999) - (b.goalsConceded ?? 9999);
      if (sortKey === 'bigChancesMissed') return (a.bigChancesMissed ?? 9999) - (b.bigChancesMissed ?? 9999);
      const av = statValue(a, sortKey) ?? -1;
      const bv = statValue(b, sortKey) ?? -1;
      return bv - av;
    });
    return list;
  }, [players, sortKey, posFilter]);

  const groupMaxima = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const group of ['GK', 'DEF', 'MID', 'FWD']) {
      const gp = players.filter((p) => p.positionGroup === group);
      const axes = RADAR_CONFIG[group] ?? [];
      const maxes: Record<string, number> = {};
      for (const ax of axes) {
        const vals = gp.map((p) => (p[ax.key] as number | null) ?? 0).filter((v) => v > 0);
        maxes[ax.key] = vals.length > 0 ? Math.max(...vals) : 1;
      }
      result[group] = maxes;
    }
    return result;
  }, [players]);

  const rated      = players.filter((p) => p.rating !== null);
  const avgRating  = rated.length ? (rated.reduce((s, p) => s + p.rating!, 0) / rated.length).toFixed(2) : '—';
  const totalGoals = players.reduce((s, p) => s + p.goals, 0);
  const bestRated  = [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const gks        = players.filter((p) => p.positionGroup === 'GK');
  const totalCS    = gks.reduce((s, p) => s + (p.cleanSheets ?? 0), 0);
  const fwdMid     = players.filter((p) => p.positionGroup === 'FWD' || p.positionGroup === 'MID');
  const totalXG    = fwdMid.reduce((s, p) => s + (p.expectedGoals ?? 0), 0);

  return (
    <>
    <ProgressBar loading={loading || refreshing} />
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-6xl">
        <Breadcrumbs />

        <div className="mt-6 mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500">{league?.country} · {league?.name}</p>
            <h1 className="mt-0.5 text-2xl font-bold text-white">Squad Analytics</h1>
          </div>
          <div className="flex items-center gap-3">
            {updatedLabel && (
              <span className="text-xs text-gray-500">Updated {updatedLabel}</span>
            )}
            <button
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:bg-gray-700 hover:text-white disabled:opacity-40"
            >
              {refreshing && (
                <span className="h-3 w-3 rounded-full border-2 border-gray-500 border-t-white animate-spin" />
              )}
              Refresh
            </button>
          </div>
        </div>

        <LeagueNav leagueId={leagueId} />

        <div className="mb-8" />

        {loading ? (
          <AnalyticsSkeleton />
        ) : players.length === 0 ? (
          <EmptyState leagueId={leagueId} />
        ) : (
          <>
            {/* Summary cards */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="Avg Rating"   value={String(avgRating)}  accent="text-green-400" />
              <SummaryCard label="Total Goals"  value={String(totalGoals)} />
              <SummaryCard label="xG (MID+FWD)" value={totalXG > 0 ? totalXG.toFixed(1) : '—'} accent="text-blue-400" />
              <SummaryCard
                label="Best Rated"
                value={bestRated ? `${bestRated.name.split(' ').pop()} ${bestRated.rating?.toFixed(2)}` : '—'}
                accent="text-yellow-400"
              />
            </div>

            {gks.length > 0 && totalCS > 0 && (
              <div className="mb-5 flex flex-wrap gap-3">
                {[
                  { label: 'GK Clean Sheets', value: totalCS },
                  { label: 'GK Saves', value: gks.reduce((s, p) => s + (p.saves ?? 0), 0) },
                  { label: 'Total Assists', value: players.reduce((s, p) => s + p.assists, 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-white/8 bg-gray-900 px-4 py-2 text-sm">
                    <span className="text-gray-500">{label}: </span>
                    <span className="font-bold text-white">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-xl border border-white/8 bg-gray-900 p-1">
                {POS_FILTERS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setPosFilter(pos)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      posFilter === pos ? 'bg-white text-gray-900' : 'text-gray-500 hover:text-white'
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1">
                {visibleCols.map((col) => (
                  <button
                    key={col.key}
                    onClick={() => setSortKey(col.key)}
                    title={col.label}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      sortKey === col.key
                        ? 'border-white/25 bg-white/10 text-white'
                        : 'border-white/8 text-gray-500 hover:text-white'
                    }`}
                  >
                    {col.short}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex gap-0.5 rounded-lg border border-white/8 bg-gray-900 p-0.5">
                {(['cards', 'table'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`rounded px-3 py-1 text-xs font-semibold capitalize transition ${
                      viewMode === mode ? 'bg-white text-gray-900' : 'text-gray-500 hover:text-white'
                    }`}
                  >
                    {mode === 'cards' ? 'Cards' : 'Table'}
                  </button>
                ))}
              </div>
            </div>

            {viewMode === 'cards' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sorted.map((player, i) => (
                  <AnalyticsCard
                    key={player.playerId}
                    player={player}
                    rank={i + 1}
                    form={form[String(player.playerId)] ?? []}
                    formLoading={loadingForm}
                    maxima={groupMaxima[player.positionGroup] ?? {}}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/8">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-gray-900 text-left">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">#</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Player</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-600">Form</th>
                      {visibleCols.map((col) => (
                        <th
                          key={col.key}
                          title={col.label}
                          className={`px-3 py-3 text-right cursor-pointer select-none whitespace-nowrap ${
                            sortKey === col.key ? 'text-white' : (col.color ?? 'text-gray-600')
                          }`}
                          onClick={() => setSortKey(col.key)}
                        >
                          <span className="block text-[11px] font-semibold uppercase tracking-wider leading-tight">
                            {col.short}
                          </span>
                          <span className="block text-[9px] font-normal normal-case tracking-normal text-gray-600 leading-tight">
                            {col.label}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sorted.map((player, i) => (
                      <tr key={player.playerId} className="bg-gray-950 transition hover:bg-gray-900/60">
                        <td className="px-4 py-3 text-xs tabular-nums text-gray-600">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-800">
                              <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{player.name}</p>
                              <div className="flex items-center gap-1">
                                <div className="relative h-3.5 w-3.5 shrink-0">
                                  <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
                                </div>
                                <p className="text-xs text-gray-600">
                                  {player.mantraPositions.length > 0 ? player.mantraPositions.join('/') : player.position}
                                  {' · '}{player.teamName}
                                </p>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <FormStrip
                            matches={form[String(player.playerId)] ?? []}
                            loading={loadingForm}
                            size="sm"
                          />
                        </td>
                        {visibleCols.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-3 text-right tabular-nums ${
                              col.key === 'rating'          ? `font-bold ${ratingColor(player.rating)}`
                              : col.key === 'goalsConceded' || col.key === 'bigChancesMissed' ? 'text-red-400'
                              : col.key === 'yellowCards'   ? 'text-yellow-500'
                              : col.key === 'redCards'      ? 'text-red-500'
                              : col.key === 'cleanSheets' || col.key === 'saves' ? 'text-blue-400'
                              : col.key === 'expectedGoals' ? 'text-purple-400'
                              : col.key === 'tackles' || col.key === 'interceptions' || col.key === 'clearances' ? 'text-sky-400'
                              : 'text-white'
                            }`}
                          >
                            {col.key === 'rating'
                              ? (player.rating?.toFixed(2) ?? '—')
                              : formatStat(player, col.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
    </>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────
