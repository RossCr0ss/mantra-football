'use client';

import type { PlayerRecentMatch } from '@/lib/fotmob';
import { ratingColor, resultDotClass } from '@/components/analytics/analyticsUi';

export function FormDot({
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

export function FormStrip({
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

export function RecentMatchesList({ matches }: { matches: PlayerRecentMatch[] }) {
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
