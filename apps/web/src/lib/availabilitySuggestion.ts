import type { PositionGroup, SquadPlayer } from '@/types/squad';
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

/** What to do with one hand-set Start % when resetting it: take the suggestion, or drop it (minutes model). */
export type AvailabilityReset =
  | { playerId: number; action: 'suggest'; pct: number }
  | { playerId: number; action: 'clear' };

/**
 * Plan for "reset all custom Start %": every `manual` player gets the suggested value from recent form;
 * with no suggestion the value is cleared altogether so the tour falls back to the minutes-based estimate
 * instead of keeping the hand-set number.
 */
export function planAvailabilityReset(
  players: Pick<SquadPlayer, 'id' | 'availabilityPctSource'>[],
  suggestedById: Record<number, number | null | undefined>,
): AvailabilityReset[] {
  return players
    .filter((p) => p.availabilityPctSource === 'manual')
    .map((p): AvailabilityReset => {
      const pct = suggestedById[p.id];
      return pct != null ? { playerId: p.id, action: 'suggest', pct } : { playerId: p.id, action: 'clear' };
    });
}
