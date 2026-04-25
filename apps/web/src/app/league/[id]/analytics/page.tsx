'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LEAGUES } from '@/lib/fotmob';
import type { PlayerRecentMatch } from '@/lib/fotmob';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import { ProgressBar } from '@/components/LoadingProgressBar';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';

type PositionFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'FWD';
type ViewMode = 'table' | 'cards';

type SortKey =
  | 'rating' | 'goals' | 'assists' | 'matchesPlayed' | 'leagueRank' | 'yellowCards' | 'redCards'
  | 'cleanSheets' | 'saves' | 'goalsConceded' | 'savePercentage' | 'goalsPrevented' | 'penaltySaves'
  | 'tackles' | 'interceptions' | 'clearances' | 'blockedShots' | 'aerialsWon'
  | 'expectedGoals' | 'shots' | 'chancesCreated' | 'successfulDribbles'
  | 'bigChancesCreated' | 'bigChancesMissed';

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

const POS_BADGE: Record<string, string> = {
  GK:  'bg-yellow-900/60 text-yellow-400',
  DEF: 'bg-sky-900/60 text-sky-400',
  MID: 'bg-emerald-900/60 text-emerald-400',
  FWD: 'bg-orange-900/60 text-orange-400',
};

function ratingColor(r: number | null): string {
  if (r === null) return 'text-gray-600';
  if (r >= 8.0)   return 'text-emerald-400';
  if (r >= 7.5)   return 'text-green-400';
  if (r >= 7.0)   return 'text-yellow-400';
  if (r >= 6.5)   return 'text-orange-400';
  return 'text-red-400';
}

function resultDotClass(r: 'W' | 'D' | 'L' | null): string {
  if (r === 'W') return 'bg-green-600 text-white';
  if (r === 'D') return 'bg-amber-500 text-gray-900';
  if (r === 'L') return 'bg-red-600 text-white';
  return 'bg-gray-700 text-gray-500';
}

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

// ─── Form components ──────────────────────────────────────────────────────────

function FormDot({
  match,
  size = 'md',
}: {
  match: PlayerRecentMatch | null;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5 text-[8px]' : 'h-5 w-5 text-[9px]';
  if (!match) {
    return <div className={`${dim} rounded-full bg-gray-800 border border-white/5`} />;
  }
  const title = [
    `${match.isHome ? 'vs' : '@'} ${match.opponentName}`,
    match.goalsFor != null ? `${match.goalsFor}–${match.goalsAgainst}` : '',
    match.rating != null ? `⭐ ${match.rating.toFixed(1)}` : '',
    match.goals > 0 ? `${match.goals}G` : '',
    match.assists > 0 ? `${match.assists}A` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div
      title={title}
      className={`${dim} rounded-full flex items-center justify-center font-bold cursor-default shrink-0 ${resultDotClass(match.result)}`}
    >
      {match.result ?? '?'}
    </div>
  );
}

function FormStrip({
  matches,
  loading,
  size = 'md',
}: {
  matches: PlayerRecentMatch[];
  loading: boolean;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  if (loading) {
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${dim} rounded-full bg-gray-700 animate-pulse`} />
        ))}
      </div>
    );
  }
  // Pad to always show 5 slots (oldest → newest left → right)
  const slots: (PlayerRecentMatch | null)[] = Array.from({ length: 5 }, (_, i) => matches[i] ?? null);
  return (
    <div className="flex items-center gap-1">
      {slots.map((m, i) => <FormDot key={i} match={m} size={size} />)}
    </div>
  );
}

function RecentMatchesList({ matches }: { matches: PlayerRecentMatch[] }) {
  return (
    <div className="space-y-1 rounded-lg bg-gray-800/40 px-2.5 py-2">
      {matches.map((m, i) => (
        <div key={m.matchId || i} className="flex items-center gap-2 text-xs">
          <span
            className={`shrink-0 w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold ${resultDotClass(m.result)}`}
          >
            {m.result ?? '?'}
          </span>
          <span className="text-gray-400 flex-1 min-w-0 truncate">
            {m.isHome ? 'vs' : '@'} {m.opponentName}
            {m.goalsFor != null && (
              <span className="text-gray-600 ml-1">{m.goalsFor}–{m.goalsAgainst}</span>
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {m.goals > 0 && <span className="text-green-400 font-semibold">{m.goals}G</span>}
            {m.assists > 0 && <span className="text-teal-400 font-semibold">{m.assists}A</span>}
            {m.yellowCard && <span className="text-yellow-500 font-bold text-[10px]">Y</span>}
            {m.redCard && <span className="text-red-500 font-bold text-[10px]">R</span>}
            {m.minutesPlayed != null && m.minutesPlayed < 60 && (
              <span className="text-gray-600">{m.minutesPlayed}&apos;</span>
            )}
            {m.rating != null && (
              <span className={`font-bold tabular-nums ${ratingColor(m.rating)}`}>
                {m.rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stat name descriptions ───────────────────────────────────────────────────

const STAT_TITLES: Record<string, string> = {
  CS: 'Clean Sheets', SV: 'Saves', GC: 'Goals Conceded', 'SV%': 'Save Percentage',
  GP: 'Goals Prevented', PSv: 'Penalty Saves', Swp: 'Sweeper Actions',
  HC: 'High Claims', ELG: 'Errors Leading to Goal',
  Tk: 'Tackles', Int: 'Interceptions', Clr: 'Clearances', Blk: 'Blocked Shots',
  AW: 'Aerials Won', P3rd: 'Possession Won in Final Third',
  FC: 'Fouls Committed', DP: 'Dribbled Past',
  G: 'Goals', A: 'Assists', xG: 'Expected Goals',
  Sh: 'Shots on Target', KP: 'Key Passes', BCC: 'Big Chances Created',
  BCM: 'Big Chances Missed', Drb: 'Successful Dribbles',
};

// ─── Card stat components ─────────────────────────────────────────────────────

interface StatCell {
  label: string;
  value: string | number | null;
  color?: string;
  negative?: boolean;
}

function val(v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function PrimaryStats({ cells }: { cells: StatCell[] }) {
  const cols = Math.min(cells.length, 4);
  return (
    <div
      className="grid gap-px overflow-hidden rounded-lg bg-white/5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          title={STAT_TITLES[c.label] ?? c.label}
          className="flex flex-col items-center bg-gray-800/60 px-2 py-2.5 text-center"
        >
          <span className={`text-lg font-bold tabular-nums leading-tight ${
            val(c.value) === '—' ? 'text-gray-600' : (c.color ?? 'text-white')
          }`}>
            {val(c.value)}
          </span>
          <span className="mt-0.5 text-[10px] font-medium text-gray-500 leading-none uppercase tracking-wide">
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function AdditionalStats({ cells }: { cells: StatCell[] }) {
  const visible = cells.filter((c) => val(c.value) !== '—');
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg bg-gray-800/30 px-3 py-2">
      {visible.map((c) => (
        <span key={c.label} title={STAT_TITLES[c.label] ?? c.label} className="text-xs text-gray-500 cursor-default">
          {c.label}{' '}
          <span className={`font-semibold ${c.negative ? 'text-red-400' : (c.color ?? 'text-gray-200')}`}>
            {val(c.value)}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Analytics card ───────────────────────────────────────────────────────────

function AnalyticsCard({
  player,
  rank,
  form,
  formLoading,
}: {
  player: PlayerAnalytics;
  rank: number;
  form: PlayerRecentMatch[];
  formLoading: boolean;
}) {
  const [showMatches, setShowMatches] = useState(false);
  const pg = player.positionGroup;
  const p = player;

  const hasFormData = form.length > 0;
  const showFormSection = formLoading || hasFormData;

  let primaryStats: StatCell[];
  let additionalStats: StatCell[];

  if (pg === 'GK') {
    primaryStats = [
      { label: 'CS',   value: p.cleanSheets,                                           color: 'text-blue-400'  },
      { label: 'SV',   value: p.saves,                                                 color: 'text-green-400' },
      { label: 'GC',   value: p.goalsConceded,                                         color: 'text-red-400', negative: true },
      { label: 'SV%',  value: p.savePercentage != null ? `${p.savePercentage}%` : null, color: 'text-cyan-400'  },
    ];
    additionalStats = [
      { label: 'GP',   value: p.goalsPrevented,  color: 'text-emerald-400' },
      { label: 'PSv',  value: p.penaltySaves,    color: 'text-amber-400'   },
      { label: 'Swp',  value: p.actedSweeper,    color: 'text-sky-400'     },
      { label: 'HC',   value: p.highClaims,      color: 'text-indigo-400'  },
      { label: 'ELG',  value: p.errorLeadToGoal, negative: true            },
    ];
  } else if (pg === 'DEF') {
    primaryStats = [
      { label: 'Tk',   value: p.tackles,       color: 'text-sky-400'    },
      { label: 'Int',  value: p.interceptions, color: 'text-indigo-400' },
      { label: 'Clr',  value: p.clearances,    color: 'text-purple-400' },
      { label: 'CS',   value: p.cleanSheets,   color: 'text-blue-400'   },
    ];
    additionalStats = [
      { label: 'G',    value: p.goals,                  color: 'text-green-400'   },
      { label: 'A',    value: p.assists,                color: 'text-teal-400'    },
      { label: 'Blk',  value: p.blockedShots,           color: 'text-orange-400'  },
      { label: 'AW',   value: p.aerialsWon,             color: 'text-amber-400'   },
      { label: 'P3rd', value: p.possessionWonFinal3rd,  color: 'text-emerald-400' },
      { label: 'FC',   value: p.foulsCommitted,         negative: true            },
      { label: 'DP',   value: p.dribbledPast,           negative: true            },
    ];
  } else if (pg === 'MID') {
    primaryStats = [
      { label: 'G',    value: p.goals,           color: 'text-green-400'  },
      { label: 'A',    value: p.assists,         color: 'text-teal-400'   },
      { label: 'KP',   value: p.chancesCreated,  color: 'text-indigo-400' },
      { label: 'xG',   value: p.expectedGoals != null ? p.expectedGoals.toFixed(1) : null, color: 'text-purple-400' },
    ];
    additionalStats = [
      { label: 'BCC',  value: p.bigChancesCreated,   color: 'text-emerald-400' },
      { label: 'Sh',   value: p.shots,               color: 'text-orange-400'  },
      { label: 'Drb',  value: p.successfulDribbles,  color: 'text-sky-400'     },
      { label: 'Tk',   value: p.tackles,             color: 'text-blue-400'    },
      { label: 'Int',  value: p.interceptions,       color: 'text-cyan-400'    },
      { label: 'FC',   value: p.foulsCommitted,      negative: true            },
    ];
  } else {
    primaryStats = [
      { label: 'G',    value: p.goals,           color: 'text-green-400'  },
      { label: 'A',    value: p.assists,         color: 'text-teal-400'   },
      { label: 'xG',   value: p.expectedGoals != null ? p.expectedGoals.toFixed(1) : null, color: 'text-purple-400' },
      { label: 'Sh',   value: p.shots,           color: 'text-orange-400' },
    ];
    additionalStats = [
      { label: 'BCM',  value: p.bigChancesMissed,    negative: true            },
      { label: 'KP',   value: p.chancesCreated,      color: 'text-indigo-400'  },
      { label: 'Drb',  value: p.successfulDribbles,  color: 'text-sky-400'     },
      { label: 'AW',   value: p.aerialsWon,          color: 'text-amber-400'   },
    ];
  }

  return (
    <div className="rounded-xl border border-white/8 bg-gray-900 p-3.5 space-y-2.5 flex flex-col">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 text-xs tabular-nums text-gray-600 w-4 mt-1">{rank}</span>
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-gray-800">
          <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white text-sm leading-snug truncate">{player.name}</p>
          <p className="text-[11px] text-gray-500 truncate">{player.teamName}</p>
          <div className="mt-1 flex items-center gap-1">
            {player.mantraPositions.length > 0 ? (
              player.mantraPositions.map((mp) => {
                const def = MANTRA_POSITIONS.find((d) => d.code === mp);
                const badgeGroup = def?.group ?? pg;
                return (
                  <span key={mp} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${POS_BADGE[badgeGroup] ?? 'bg-gray-800 text-gray-400'}`}>
                    {mp}
                  </span>
                );
              })
            ) : (
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${POS_BADGE[pg] ?? 'bg-gray-800 text-gray-400'}`}>
                {player.position}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xl font-bold tabular-nums leading-tight ${ratingColor(player.rating)}`}>
            {player.rating?.toFixed(2) ?? '—'}
          </p>
          <p className="text-[10px] text-gray-600">rating</p>
        </div>
      </div>

      {/* Form strip */}
      {showFormSection && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-600 uppercase tracking-wide font-medium shrink-0">Form</span>
            <FormStrip matches={form} loading={formLoading} />
          </div>
          {hasFormData && (
            <button
              onClick={() => setShowMatches((v) => !v)}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition shrink-0"
            >
              {showMatches ? 'Hide' : 'Details'}
            </button>
          )}
        </div>
      )}

      {/* Recent match details (expandable) */}
      {showMatches && hasFormData && <RecentMatchesList matches={form} />}

      {/* Primary stats */}
      <PrimaryStats cells={primaryStats} />

      {/* Additional stats */}
      <AdditionalStats cells={additionalStats} />

      {/* Footer */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 border-t border-white/5 pt-1.5">
        {player.matchesPlayed != null && (
          <span>MP <span className="text-gray-400 font-medium">{player.matchesPlayed}</span></span>
        )}
        {player.minutesPlayed != null && (
          <span>Min <span className="text-gray-400 font-medium">{player.minutesPlayed}</span></span>
        )}
        {player.leagueRank != null && (
          <span>Rank <span className="text-gray-400 font-medium">#{player.leagueRank}</span></span>
        )}
        {player.yellowCards > 0 && (
          <span>YC <span className="text-yellow-500 font-bold">{player.yellowCards}</span></span>
        )}
        {player.redCards > 0 && (
          <span>RC <span className="text-red-500 font-bold">{player.redCards}</span></span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
    const analyticsUrl = `/api/leagues/${leagueId}/analytics${refresh ? '?refresh=1' : ''}`;
    const formUrl      = `/api/leagues/${leagueId}/form${refresh ? '?refresh=1' : ''}`;

    if (refresh) setRefreshing(true); else setLoading(true);
    setLoadingForm(true);

    fetch(analyticsUrl)
      .then((r) => r.json())
      .then((d) => {
        setPlayers(d.players ?? []);
        setDataUpdatedAt(d.dataUpdatedAt ?? null);
      })
      .finally(() => { setLoading(false); setRefreshing(false); });

    fetch(formUrl)
      .then((r) => r.json())
      .then((d) => setForm(d.form ?? {}))
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
                              <p className="text-xs text-gray-600">
                                {player.mantraPositions.length > 0 ? player.mantraPositions.join('/') : player.position}
                                {' · '}{player.teamName}
                              </p>
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

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 px-5 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

function EmptyState({ leagueId }: { leagueId: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-20 text-center">
      <p className="mt-3 font-semibold text-white">No squad saved yet</p>
      <p className="mt-1 text-sm text-gray-500">Build your squad to see analytics</p>
      <Link
        href={`/league/${leagueId}`}
        className="mt-6 inline-block rounded-xl bg-green-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600"
      >
        Build Squad
      </Link>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/8 bg-gray-900 px-5 py-4">
            <div className="shimmer h-3 w-16 rounded" />
            <div className="shimmer mt-2 h-7 w-12 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/8 bg-gray-900 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="shimmer h-11 w-11 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="shimmer h-3.5 w-28 rounded" />
                <div className="shimmer h-3 w-20 rounded" />
              </div>
              <div className="shimmer h-7 w-12 rounded" />
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="shimmer h-5 w-5 rounded-full" />
              ))}
            </div>
            <div className="shimmer h-14 w-full rounded-lg" />
            <div className="shimmer h-8 w-full rounded-lg" />
            <div className="shimmer h-4 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
