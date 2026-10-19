import type { EnrichedPlayer } from '@/lib/tourModules';

/** One squad player as the tour engine saw him when the recommendation was made. */
export interface TourLogPlayer {
  id: number;
  name: string;
  teamId: number;
  group: string;
  mantraPositions: string[];
  score: number;
  startProb: number;
  expectedPoints: number;
  baseRating: number;
  availabilityPct: number | null;
  availabilityPctSource: string | null;
  lineupStatus: string | null;
  matchId: string | null;
  isHome: boolean | null;
  difficulty: number | null;
  odds: { home: number | null; draw: number | null; away: number | null } | null;
}

/** Snapshot of a tour recommendation, stored to backtest the engine against real results later. */
export interface TourLogEntry {
  round: string;
  formation: string;
  defenceBonus: number;
  /** Slot-ordered ids (0 = GK) and the malus of each slot. */
  slots: number[];
  penalty: number[];
  players: TourLogPlayer[];
}

/** Builds the snapshot of the engine's own recommendation (no pinned formation) for a round. */
export function buildTourLogEntry(
  players: EnrichedPlayer[],
  best: { moduleName: string; defenceBonus: number; assignment: { ids: number[]; penalty: number[] } },
  round: string,
): TourLogEntry {
  return {
    round,
    formation: best.moduleName,
    defenceBonus: best.defenceBonus,
    slots: best.assignment.ids,
    penalty: best.assignment.penalty,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      group: p.positionGroup,
      mantraPositions: p.mantraPositions,
      score: p.scoreBreakdown.total,
      startProb: p.scoreBreakdown.startProb,
      expectedPoints: p.scoreBreakdown.expectedPoints,
      baseRating: p.scoreBreakdown.baseRating,
      availabilityPct: p.availabilityPct ?? null,
      availabilityPctSource: p.availabilityPctSource ?? null,
      lineupStatus: p.lineupStatus ?? null,
      matchId: p.nextFixture?.matchId ?? null,
      isHome: p.nextFixture?.isHome ?? null,
      difficulty: p.nextFixture?.difficulty ?? null,
      odds: p.odds ? { home: p.odds.home, draw: p.odds.draw, away: p.odds.away } : null,
    })),
  };
}
