'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { PlayerRecentMatch } from '@/lib/fotmob';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';
import { POSITION_RING } from '@/lib/positionGroups';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { POS_BADGE, STAT_TITLES, StatCell, ratingColor, val } from '@/components/analytics/analyticsUi';
import { FormStrip, RecentMatchesList } from '@/components/analytics/FormWidgets';
import { RadarChart } from '@/components/analytics/RadarChart';

export function PrimaryStats({ cells }: { cells: StatCell[] }) {
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

export function AdditionalStats({ cells }: { cells: StatCell[] }) {
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

export function AnalyticsCard({
  player,
  rank,
  form,
  formLoading,
  maxima,
}: {
  player: PlayerAnalytics;
  rank: number;
  form: PlayerRecentMatch[];
  formLoading: boolean;
  maxima: Record<string, number>;
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
      <div className="flex items-center gap-3">
        {/* Avatar + rank badge */}
        <div className="relative shrink-0">
          <div className={`relative h-9 w-9 overflow-hidden rounded-full bg-gray-800 ring-2 ${POSITION_RING[pg] ?? 'ring-white/10'}`}>
            <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-950 text-[8px] font-bold tabular-nums text-gray-500 ring-1 ring-gray-700">
            {rank}
          </span>
        </div>

        {/* Name / team / positions */}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white text-sm leading-snug truncate">{player.name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <div className="relative h-3.5 w-3.5 shrink-0">
              <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
            </div>
            <p className="text-[11px] text-gray-500 truncate">{player.teamName}</p>
          </div>
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

        {/* Rating */}
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-bold tabular-nums leading-tight ${ratingColor(player.rating)}`}>
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

      {/* Stats + Radar side by side */}
      <div className="flex gap-2 items-start">
        <div className="w-[38%] shrink-0">
          <RadarChart player={p} group={pg} maxima={maxima} />
        </div>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <PrimaryStats cells={primaryStats} />
          <AdditionalStats cells={additionalStats} />
        </div>
      </div>

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
