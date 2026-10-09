import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';

export type SortKey =
  | 'rating' | 'goals' | 'assists' | 'matchesPlayed' | 'leagueRank' | 'yellowCards' | 'redCards'
  | 'cleanSheets' | 'saves' | 'goalsConceded' | 'savePercentage' | 'goalsPrevented' | 'penaltySaves'
  | 'tackles' | 'interceptions' | 'clearances' | 'blockedShots' | 'aerialsWon'
  | 'expectedGoals' | 'shots' | 'chancesCreated' | 'successfulDribbles'
  | 'bigChancesCreated' | 'bigChancesMissed';

export const POS_BADGE: Record<string, string> = {
  GK:  'bg-yellow-900/60 text-yellow-400',
  DEF: 'bg-sky-900/60 text-sky-400',
  MID: 'bg-emerald-900/60 text-emerald-400',
  FWD: 'bg-orange-900/60 text-orange-400',
};

export function ratingColor(r: number | null): string {
  if (r === null) return 'text-gray-600';
  if (r >= 8.0)   return 'text-emerald-400';
  if (r >= 7.5)   return 'text-green-400';
  if (r >= 7.0)   return 'text-yellow-400';
  if (r >= 6.5)   return 'text-orange-400';
  return 'text-red-400';
}

export function resultDotClass(r: 'W' | 'D' | 'L' | null): string {
  if (r === 'W') return 'bg-green-600 text-white';
  if (r === 'D') return 'bg-amber-500 text-gray-900';
  if (r === 'L') return 'bg-red-600 text-white';
  return 'bg-gray-700 text-gray-500';
}

export const STAT_TITLES: Record<string, string> = {
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

// ─── Radar chart ──────────────────────────────────────────────────────────────

export const RADAR_CONFIG: Record<string, Array<{ key: keyof PlayerAnalytics; label: string; negative?: boolean }>> = {
  GK:  [
    { key: 'saves',         label: 'SV'  },
    { key: 'cleanSheets',   label: 'CS'  },
    { key: 'goalsConceded', label: 'GC',  negative: true },
    { key: 'matchesPlayed', label: 'MP'  },
    { key: 'foulsCommitted',label: 'FC',  negative: true },
  ],
  DEF: [
    { key: 'tackles',       label: 'Tk'  },
    { key: 'interceptions', label: 'Int' },
    { key: 'clearances',    label: 'Clr' },
    { key: 'cleanSheets',   label: 'CS'  },
    { key: 'goals',         label: 'G'   },
  ],
  MID: [
    { key: 'chancesCreated',label: 'KP'  },
    { key: 'expectedGoals', label: 'xG'  },
    { key: 'goals',         label: 'G'   },
    { key: 'assists',       label: 'A'   },
    { key: 'tackles',       label: 'Tk'  },
  ],
  FWD: [
    { key: 'goals',         label: 'G'   },
    { key: 'expectedGoals', label: 'xG'  },
    { key: 'shots',         label: 'Sh'  },
    { key: 'assists',       label: 'A'   },
    { key: 'chancesCreated',label: 'KP'  },
  ],
};

export const RADAR_PALETTE: Record<string, { stroke: string; fill: string; dot: string }> = {
  GK:  { stroke: '#facc15', fill: 'rgba(250,204,21,0.15)',  dot: '#facc15' },
  DEF: { stroke: '#38bdf8', fill: 'rgba(56,189,248,0.15)',  dot: '#38bdf8' },
  MID: { stroke: '#34d399', fill: 'rgba(52,211,153,0.15)',  dot: '#34d399' },
  FWD: { stroke: '#fb923c', fill: 'rgba(251,146,60,0.15)',  dot: '#fb923c' },
};

export interface StatCell {
  label: string;
  value: string | number | null;
  color?: string;
  negative?: boolean;
}

export function val(v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}
