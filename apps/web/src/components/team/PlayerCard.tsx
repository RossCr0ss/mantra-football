'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { SquadPlayer, MantraPosition, PositionGroup, LineupStatus } from '@/types/squad';
import { isReturningToday } from '@/lib/injuryDate';
import type { PlayerInjuryInfo, PlayerRecentMatch, PlayerSeasonStats } from '@/lib/fotmob';
import { MANTRA_POSITIONS, MANTRA_POSITION_COLOR, type MantraPositionDef } from '@/lib/mantraPositions';
import { POSITION_RING, effectivePositionGroup } from '@/lib/positionGroups';
import type { PlayerSuspensionInfo } from '@/lib/suspensionCheck';
import { YELLOW_CARD_WARNING_THRESHOLD } from '@/lib/suspensionRules';

export interface PlayerForm {
  matches: PlayerRecentMatch[];
  suggestedPct: number | null;
  goalsRecent: number;
  assistsRecent: number;
  cleanSheetsRecent: number;
}

export function pctAccentColor(pct: number): string {
  if (pct === 100) return '#4ade80';
  if (pct >= 75)   return '#86efac';
  if (pct >= 50)   return '#60a5fa';
  if (pct >= 25)   return '#fbbf24';
  if (pct > 0)     return '#fb923c';
  return '#6b7280';
}

export function pctTextClass(pct: number): string {
  if (pct === 100) return 'text-green-400';
  if (pct >= 75)   return 'text-green-300';
  if (pct >= 50)   return 'text-blue-400';
  if (pct >= 25)   return 'text-yellow-400';
  if (pct > 0)     return 'text-orange-400';
  return 'text-gray-500';
}

export const POSITIONS_BY_GROUP = MANTRA_POSITIONS.reduce<Partial<Record<PositionGroup, MantraPositionDef[]>>>(
  (acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  },
  {},
);

export function SectionHeader({
  badge,
  badgeClass,
  badgeStyle,
  title,
  count,
}: {
  badge: string;
  badgeClass?: string;
  badgeStyle?: React.CSSProperties;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className={`rounded-lg px-2.5 py-1 text-xs font-bold tracking-widest text-white ${badgeClass ?? ''}`}
        style={badgeStyle}
      >
        {badge}
      </span>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <span className="text-xs text-gray-600">({count})</span>
    </div>
  );
}

// ─── Player card ───────────────────────────────────────────────────────────────

export function PlayerCard({
  player,
  injury,
  form,
  seasonStats,
  suspensionInfo,
  isEditing,
  onEditToggle,
  onTogglePosition,
  onToggleStatus,
  onSetAvailability,
  onResetToAuto,
}: {
  player: SquadPlayer;
  injury?: PlayerInjuryInfo;
  form?: PlayerForm;
  seasonStats?: PlayerSeasonStats;
  suspensionInfo?: PlayerSuspensionInfo;
  isEditing: boolean;
  onEditToggle: () => void;
  onTogglePosition: (pos: MantraPosition) => void;
  onToggleStatus: (s: LineupStatus) => void;
  onSetAvailability: (pct: number) => void;
  onResetToAuto: () => void;
}) {
  const [localPct, setLocalPct] = useState<number | null>(null);
  const returning = injury ? isReturningToday(injury) : false;
  const isBlocked = player.lineupStatus === 'injured' || player.lineupStatus === 'suspended';
  const displayPct = localPct ?? (player.availabilityPct ?? 100);

  const pg = effectivePositionGroup(player);
  const cardBorderClass =
    player.lineupStatus === 'suspended' ? 'border-orange-500/20 bg-orange-950/8' :
    player.lineupStatus === 'injured'   ? 'border-red-500/20 bg-red-950/8'       :
                                          'border-white/8 bg-gray-900';

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border transition ${cardBorderClass}`}>
      {/* Header: circle avatar + name + team */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <div className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-gray-800 ring-2 ${POSITION_RING[pg] ?? 'ring-white/10'}`}>
          <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold leading-tight text-white">{player.name}</p>
            {player.lineupStatus === 'injured' && (
              <span className="shrink-0 rounded bg-red-600/80 px-1 py-0.5 text-[8px] font-bold text-white">INJ</span>
            )}
            {player.lineupStatus === 'suspended' && (
              <span className="shrink-0 rounded bg-orange-600/80 px-1 py-0.5 text-[8px] font-bold text-white">SUS</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="relative h-3.5 w-3.5 shrink-0">
              <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
            </div>
            <p className="truncate text-[10px] text-gray-500">{player.teamName}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2.5 px-3 pb-3">
      {/* Mantra positions */}
      <div className="flex flex-wrap gap-1">
        {player.mantraPositions.length === 0 ? (
          <span className="text-xs text-gray-700">No position</span>
        ) : (
          player.mantraPositions.map((pos) => {
            const def = MANTRA_POSITIONS.find((p) => p.code === pos)!;
            return (
              <span
                key={pos}
                className={`rounded border px-1.5 py-0.5 text-xs font-bold ${MANTRA_POSITION_COLOR[def.group]}`}
              >
                {pos}
              </span>
            );
          })
        )}
      </div>

      {/* Recent form */}
      {form && (
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => {
              const m = form.matches[form.matches.length - 5 + i];
              if (!m) return <span key={i} className="h-2 w-2 rounded-full bg-gray-800" />;
              return (
                <span
                  key={i}
                  title={`vs ${m.opponentName} · ${m.minutesPlayed ?? 0}'`}
                  className={`h-2 w-2 rounded-full ${m.started ? (m.minutesPlayed ?? 0) >= 60 ? 'bg-green-500' : 'bg-yellow-500' : 'bg-gray-600'}`}
                />
              );
            })}
          </div>
          <span className="text-[10px] text-gray-600">
            {form.matches.length === 0
              ? 'No recent data'
              : player.positionGroup === 'GK'
                ? `${form.cleanSheetsRecent}/${form.matches.length} CS`
                : `${form.goalsRecent}g ${form.assistsRecent}a`}
          </span>
        </div>
      )}

      {/* Suspension risk — a red/2nd-yellow in the most recent league match auto-sets
          Susp. above (see suspensionCheck.ts); accumulated yellows are shown here only
          as a soft warning, since exact ban thresholds vary by competition. */}
      {suspensionInfo && suspensionInfo.seasonYellowCards >= YELLOW_CARD_WARNING_THRESHOLD
        && player.lineupStatus !== 'suspended' && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-950/20 px-2 py-1 text-center text-[10px] font-semibold text-orange-400">
          🟨 {suspensionInfo.seasonYellowCards} yellow cards this season — ban risk
        </div>
      )}

      {/* Season stats — early in a season most fields are still 0/null until FotMob
          catches up, so show the row as soon as any one signal is available. */}
      {seasonStats && (
        seasonStats.rating != null || seasonStats.matchesPlayed
          || seasonStats.goals || seasonStats.assists || seasonStats.saves || seasonStats.cleanSheets
      ) && (
        <div className="flex items-center justify-between text-[10px] text-gray-600">
          <span>Season</span>
          <span className="font-semibold text-gray-400">
            {seasonStats.rating != null ? seasonStats.rating.toFixed(2) : '–'} rtg
            {player.positionGroup === 'GK'
              ? ` · ${seasonStats.saves ?? 0} sv · ${seasonStats.cleanSheets ?? 0} CS`
              : ` · ${seasonStats.goals ?? 0}g ${seasonStats.assists ?? 0}a`}
          </span>
        </div>
      )}

      {/* Injury / healed badge */}
      {injury?.cleared ? (
        <div className="rounded-lg border border-green-500/20 bg-green-950/30 px-2 py-1 text-center">
          <p className="text-xs font-semibold text-green-400">✓ Healed</p>
          <p className="text-[10px] text-green-600">manually cleared</p>
        </div>
      ) : injury ? (
        <div className="rounded-lg border border-red-500/20 bg-red-950/40 px-2 py-1 text-center">
          <p className="text-xs font-semibold text-red-400">{injury.name ?? 'Injured'}</p>
          {returning ? (
            <p className="text-xs font-semibold text-green-400">Returns today!</p>
          ) : injury.expectedReturn ? (
            <p className="text-xs text-red-300/60">{injury.expectedReturn}</p>
          ) : null}
        </div>
      ) : null}

      {/* Status controls */}
      <div className="space-y-0.5 rounded-lg bg-gray-950/80 p-0.5">
        {/* Injury / Suspension toggles */}
        <div className="grid grid-cols-2 gap-0.5">
          {(['injured', 'suspended'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onToggleStatus(s)}
              className={`rounded px-1 py-1 text-xs font-semibold transition border ${
                player.lineupStatus === s
                  ? s === 'injured'
                    ? 'bg-red-900/80 text-red-300 border-red-600/40'
                    : 'bg-orange-900/80 text-orange-300 border-orange-600/40'
                  : 'border-transparent text-gray-600 hover:text-gray-300'
              }`}
            >
              {s === 'injured' ? 'Injured' : 'Susp.'}
            </button>
          ))}
        </div>

        {/* Availability slider — only when not injured/suspended */}
        {!isBlocked && (
          <div className="px-1 pt-1 pb-0.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600">Start %</span>
              <div className="flex items-center gap-1.5">
                {player.availabilityPctSource === 'manual' ? (
                  <button
                    onClick={onResetToAuto}
                    title="Manually set — click to reset to the algorithm's suggestion"
                    className="rounded bg-yellow-600/90 px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-white hover:bg-yellow-500"
                  >
                    CUSTOM ↺
                  </button>
                ) : player.availabilityPctSource === 'suggested' ? (
                  <span
                    title="Calculated automatically from recent-form data"
                    className="rounded bg-sky-600/80 px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-white"
                  >
                    AUTO
                  </span>
                ) : null}
                <span className={`text-xs font-bold tabular-nums ${pctTextClass(displayPct)}`}>
                  {displayPct}%
                </span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={displayPct}
              onChange={(e) => setLocalPct(Number(e.target.value))}
              onPointerUp={(e) => {
                const val = Number((e.currentTarget as HTMLInputElement).value);
                setLocalPct(null);
                onSetAvailability(val);
              }}
              className="w-full h-1 rounded-full cursor-pointer appearance-none bg-gray-700
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-white
                [&::-moz-range-thumb]:h-3
                [&::-moz-range-thumb]:w-3
                [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-white
                [&::-moz-range-thumb]:border-0"
              style={{
                background: `linear-gradient(to right, ${pctAccentColor(displayPct)} ${displayPct}%, rgb(55,65,81) ${displayPct}%)`,
              }}
            />
          </div>
        )}
      </div>

      {/* Edit positions toggle */}
      <button
        onClick={onEditToggle}
        className={`w-full rounded-lg py-1.5 text-xs font-semibold transition ${
          isEditing
            ? 'bg-white/15 text-white'
            : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
        }`}
      >
        {isEditing ? 'Done' : 'Edit positions'}
      </button>

      {/* Inline position editor */}
      {isEditing && (
        <div className="space-y-2 rounded-xl border border-white/8 bg-gray-950 p-2">
          {Object.entries(POSITIONS_BY_GROUP).map(([grp, defs]) => (
            <div key={grp}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600">{grp}</p>
              <div className="flex flex-wrap gap-1">
                {defs!.map((def) => {
                  const active = player.mantraPositions.includes(def.code);
                  return (
                    <button
                      key={def.code}
                      onClick={() => onTogglePosition(def.code)}
                      title={`${def.label} (${def.italian})`}
                      className={`rounded border px-1.5 py-0.5 text-xs font-bold transition ${
                        active
                          ? MANTRA_POSITION_COLOR[def.group]
                          : 'border-white/8 text-gray-600 hover:text-gray-300'
                      }`}
                    >
                      {def.code}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
