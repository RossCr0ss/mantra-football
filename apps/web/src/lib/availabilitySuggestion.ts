import type { PositionGroup } from '@/types/squad';
import type { PlayerRecentMatch } from '@/lib/fotmob';

/**
 * Start % suggestion from recent league form: half weight on how often the
 * player started, half on how many minutes they actually got when they played.
 * Returns null when there's no data to have an opinion on (leaves existing value alone).
 */
export function suggestAvailabilityPct(matches: PlayerRecentMatch[]): number | null {
  if (matches.length === 0) return null;

  const startRate = matches.filter((m) => m.started).length / matches.length;
  const minutesRate =
    matches.reduce((sum, m) => sum + (m.minutesPlayed ?? 0), 0) / (matches.length * 90);

  const pct = (startRate * 0.5 + minutesRate * 0.5) * 100;
  return Math.round(pct / 5) * 5;
}

export interface RecentFormSummary {
  goalsRecent: number;
  assistsRecent: number;
  cleanSheetsRecent: number;
}

/** Clean sheets only count matches the player actually started. */
export function summarizeRecentForm(
  matches: PlayerRecentMatch[],
  positionGroup: PositionGroup,
): RecentFormSummary {
  const goalsRecent = matches.reduce((sum, m) => sum + m.goals, 0);
  const assistsRecent = matches.reduce((sum, m) => sum + m.assists, 0);

  const cleanSheetsRecent =
    positionGroup === 'GK'
      ? matches.filter((m) => m.started && m.goalsAgainst === 0).length
      : 0;

  return { goalsRecent, assistsRecent, cleanSheetsRecent };
}
