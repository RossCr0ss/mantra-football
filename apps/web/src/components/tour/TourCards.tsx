'use client';

import Image from 'next/image';
import { POSITION_SECTIONS, effectivePositionGroup } from '@/lib/positionGroups';
import { DIFFICULTY_STYLE } from '@/lib/fixtureDifficulty';
import { type EnrichedPlayer } from '@/lib/tourModules';
import { isBlocked } from '@/lib/tourScoring';
import { GROUP_COLORS, formatDate, scoreTier } from '@/components/tour/tourUi';

export function TourSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-3">
        <div className="h-5 w-40 rounded bg-gray-700" />
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/8 bg-gray-900 flex flex-col items-center gap-1.5 p-2.5">
              <div className="shimmer h-11 w-11 rounded-full" />
              <div className="shimmer h-2.5 w-14 rounded" />
              <div className="shimmer h-2 w-10 rounded" />
            </div>
          ))}
        </div>
      </div>
      {POSITION_SECTIONS.map(({ label }) => (
        <div key={label} className="space-y-2">
          <div className="h-4 w-28 rounded bg-gray-700" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-white/5 bg-gray-900 p-3 flex gap-2 items-center">
                <div className="h-10 w-10 rounded-full bg-gray-700 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-full rounded bg-gray-700" />
                  <div className="h-3 w-2/3 rounded bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Starting XI card (compact) ──────────────────────────────────────────────

export function MainCard({ player, onRemove }: { player: EnrichedPlayer; onRemove: () => void }) {
  const fix = player.nextFixture;
  const diff = fix?.difficulty ?? null;
  const ds = diff !== null ? (DIFFICULTY_STYLE[diff] ?? DIFFICULTY_STYLE[3]) : null;
  const sb = player.scoreBreakdown;
  const tier = scoreTier(sb.total);
  const colors = GROUP_COLORS[effectivePositionGroup(player)];

  return (
    <button
      onClick={onRemove}
      title="Click to remove from Starting XI"
      className="group relative flex flex-col items-center gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-gray-900 px-2 py-2.5 text-center transition hover:border-red-500/30 hover:bg-red-950/10"
    >
      {/* Score chip */}
      <span className={`absolute top-1.5 left-1.5 rounded px-1 text-[8px] font-bold tabular-nums ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
        {sb.total.toFixed(1)}
      </span>

      {/* Avatar + remove overlay */}
      <div className={`relative h-11 w-11 overflow-hidden rounded-full bg-gray-700 ring-2 transition group-hover:ring-red-400 ${colors.ring}`}>
        <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
        <div className="absolute inset-0 flex items-center justify-center bg-red-600/0 transition group-hover:bg-red-600/80">
          <span className="text-xs font-bold text-white opacity-0 transition group-hover:opacity-100">✕</span>
        </div>
      </div>

      {/* Name */}
      <p className="max-w-full truncate text-[10px] font-semibold leading-none text-white">
        {player.name.split(' ').pop()}
      </p>

      {/* Position + fixture difficulty badge */}
      <div className="flex items-center justify-center gap-0.5">
        {player.mantraPositions.slice(0, 1).map((pos) => (
          <span key={pos} className="rounded bg-white/8 px-1 py-px text-[7px] font-bold text-gray-500">{pos}</span>
        ))}
        {ds && (
          <span className={`rounded px-1 py-px text-[7px] font-bold ${ds.bg} ${ds.text}`}>{diff}</span>
        )}
      </div>
    </button>
  );
}

// ─── Squad player row (compact) ───────────────────────────────────────────────

export function SquadRow({
  player,
  isMain,
  onToggle,
}: {
  player: EnrichedPlayer;
  isMain: boolean;
  onToggle: () => void;
}) {
  const blocked = isBlocked(player);
  const availPct = player.availabilityPct ?? 100;
  const fix = player.nextFixture;
  const diff = fix?.difficulty ?? null;
  const ds = diff !== null ? (DIFFICULTY_STYLE[diff] ?? DIFFICULTY_STYLE[3]) : null;
  const sb = player.scoreBreakdown;
  const tier = scoreTier(sb.total);

  const rowClass = isMain
    ? 'border-white/30 bg-white/8 ring-1 ring-white/15'
    : blocked
    ? 'border-red-500/15 bg-red-950/10 opacity-50 cursor-not-allowed'
    : availPct < 50
    ? 'border-white/5 bg-gray-900/40 opacity-70 hover:opacity-90 hover:border-white/10'
    : 'border-white/8 bg-gray-900 hover:border-white/15 hover:bg-gray-800/50';

  return (
    <button
      onClick={onToggle}
      disabled={blocked && !isMain}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${rowClass}`}
    >
      {/* Photo */}
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-700">
        <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
      </div>

      {/* Name + team + status */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="truncate text-sm font-semibold text-white leading-tight">{player.name}</p>
          {isMain && (
            <span className="shrink-0 rounded bg-white px-1 py-0.5 text-[9px] font-bold text-gray-900">XI</span>
          )}
          {!isMain && !blocked && availPct < 100 && (
            <span className="shrink-0 rounded bg-blue-900/70 px-1 py-0.5 text-[9px] font-bold text-blue-400">{availPct}%</span>
          )}
          {player.lineupStatus === 'injured' && (
            <span className="shrink-0 rounded bg-red-900/70 px-1 py-0.5 text-[9px] font-bold text-red-400">INJ</span>
          )}
          {player.lineupStatus === 'suspended' && (
            <span className="shrink-0 rounded bg-orange-900/70 px-1 py-0.5 text-[9px] font-bold text-orange-400">SUS</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative h-3.5 w-3.5 shrink-0">
            <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
          </div>
          <p className="truncate text-[11px] text-gray-600">{player.teamName}</p>
        </div>
      </div>

      {/* Fixture */}
      {fix && ds ? (
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <div className={`h-5 w-5 flex items-center justify-center rounded text-xs font-bold ${ds.bg} ${ds.text}`}>
            {diff}
          </div>
          <div className="relative h-4 w-4">
            <Image src={fix.opponent.logoUrl} alt={fix.opponent.name} fill className="object-contain" unoptimized />
          </div>
          <span className="text-xs text-gray-500 max-w-[80px] truncate">{fix.opponent.name}</span>
          <span className="text-[10px] text-gray-700 shrink-0">{formatDate(fix.date)}</span>
        </div>
      ) : (
        <span className="hidden sm:block text-[11px] text-gray-700 shrink-0">No fixture</span>
      )}

      {/* Score + breakdown */}
      <div
        className="ml-auto shrink-0 flex flex-col items-end gap-0.5"
        title={blocked ? '' : `Expected ${sb.expectedPoints.toFixed(1)} pts if he starts · Start ${Math.round(sb.availability)}% · Quality ${sb.rating.toFixed(1)} · Context ${sb.context.toFixed(1)} · Attack ${sb.attack.toFixed(1)}`}
      >
        <span className={`rounded px-2 py-1 text-xs font-bold tabular-nums ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
          {blocked ? '—' : sb.total.toFixed(1)}
        </span>
        {!blocked && sb.total > 0 && (
          <div className="flex h-1 w-12 overflow-hidden rounded-full gap-px">
            {[
              { v: sb.rating,  cls: 'bg-yellow-400'  },
              { v: sb.context, cls: 'bg-blue-400'    },
              { v: sb.attack,  cls: 'bg-emerald-400' },
            ].map(({ v, cls }) => (
              v > 0 ? <div key={cls} className={cls} style={{ flex: v }} /> : null
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

export function StatBadge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold tabular-nums ${ok ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
