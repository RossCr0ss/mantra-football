import type { SquadPlayer, MantraPosition } from '@/types/squad';
import type { TeamFixture, FixtureOdds, PlayerRecentMatch } from '@/lib/fotmob';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { effectivePositionGroup } from '@/lib/positionGroups';
import { calcScore, computeTeamForm, type ScoreBreakdown, type TeamForm } from '@/lib/tourScoring';

// ─── Modules ──────────────────────────────────────────────────────────────────

export const MODULES: { name: string; slots: MantraPosition[][] }[] = [
  { name: '3-4-3',   slots: [['CB'],['CB'],['CB'],['WB'],['DM','CM'],['CM'],['WB'],['W','FW'],['FW','ST'],['W','FW']] },
  { name: '3-4-1-2', slots: [['CB'],['CB'],['CB'],['WB'],['DM','CM'],['CM'],['WB'],['AM'],['FW','ST'],['FW','ST']] },
  { name: '3-4-2-1', slots: [['CB'],['CB'],['CB'],['WB','W'],['DM'],['DM','CM'],['WB'],['AM'],['AM','FW'],['FW','ST']] },
  { name: '3-5-2',   slots: [['CB'],['CB'],['CB'],['WB','W'],['DM'],['DM','CM'],['CM'],['WB'],['FW','ST'],['FW','ST']] },
  { name: '3-5-1-1', slots: [['CB'],['CB'],['CB'],['DM'],['DM'],['CM'],['WB','W'],['AM','FW'],['WB','W'],['FW','ST']] },
  { name: '4-3-3',   slots: [['RB'],['CB'],['CB'],['LB'],['DM','CM'],['CM'],['DM'],['W','FW'],['FW','ST'],['W','FW']] },
  { name: '4-3-1-2', slots: [['RB'],['CB'],['CB'],['LB'],['DM','CM'],['DM'],['CM'],['AM'],['FW','ST'],['FW','ST']] },
  { name: '4-4-2',   slots: [['RB'],['CB'],['CB'],['LB'],['WB','W'],['DM','CM'],['CM'],['WB'],['FW','ST'],['FW','ST']] },
  { name: '4-1-4-1', slots: [['RB'],['CB'],['CB'],['LB'],['DM'],['WB','W'],['CM','AM'],['AM'],['W'],['FW','ST']] },
  { name: '4-4-1-1', slots: [['RB'],['CB'],['CB'],['LB'],['WB','W'],['DM'],['CM'],['WB','W'],['AM','FW'],['FW','ST']] },
  { name: '4-2-3-1', slots: [['RB'],['CB'],['CB'],['LB'],['DM'],['DM','CM'],['W','AM'],['AM'],['W','FW'],['FW','ST']] },
  { name: '4-3-2-1', slots: [['RB'],['CB'],['CB'],['LB'],['DM','CM'],['DM'],['CM'],['AM','FW'],['FW','ST'],['AM','FW']] },
];

// ─── Position compatibility ───────────────────────────────────────────────────

/**
 * For each module slot position: which player native positions can fill it,
 * and what score malus applies (0 = native, -1.5 = adjacent, -3 = stretch).
 * Positions not listed are incompatible.
 */
export const POSITION_MALUS: Record<MantraPosition, Partial<Record<MantraPosition, number>>> = {
  GK:  { GK: 0 },
  LB:  { LB: 0, RB: -1.5, CB: -1.5, WB: -3 },
  RB:  { RB: 0, LB: -1.5, CB: -1.5, WB: -3 },
  CB:  { CB: 0, LB: -1.5, RB: -1.5, DM: -3 },
  WB:  { WB: 0, LB: -3, RB: -3, DM: -1.5, CM: -1.5 },
  DM:  { DM: 0, CM: -1.5, WB: -3, CB: -3 },
  CM:  { CM: 0, DM: -1.5, AM: -3 },
  AM:  { AM: 0, CM: -3, W: -3, FW: -3 },
  W:   { W: 0, AM: -1.5, FW: -3 },
  FW:  { FW: 0, W: -3, AM: -3, ST: -1.5 },
  ST:  { ST: 0, FW: -1.5, W: -3 },
};

/**
 * Best (least-negative) malus for placing a player with `playerPositions` into
 * a slot that accepts `slotPositions`.  Returns undefined if incompatible.
 */
export function getSlotPenalty(slotPositions: MantraPosition[], playerPositions: MantraPosition[]): number | undefined {
  let best: number | undefined;
  for (const slotPos of slotPositions) {
    const compat = POSITION_MALUS[slotPos];
    if (!compat) continue;
    for (const playerPos of playerPositions) {
      const malus = compat[playerPos];
      if (malus !== undefined && (best === undefined || malus > best)) best = malus;
    }
  }
  return best;
}

/**
 * Applies the position penalty only to the rating component, matching the real
 * game: penalizedRating = baseRating + pen, then ratingScore is recomputed.
 * All other components (fixture, odds, position stats, minutes) are unchanged.
 *
 *   pen  0   → no change
 *   pen -1.5 → e.g. 7.5 → 6.0 → ratingScore drops to 0
 *   pen -3   → e.g. 7.0 → 4.0 → ratingScore drops to 0
 */
export function effectiveScore(breakdown: ScoreBreakdown, pen: number): number {
  if (pen === 0) return breakdown.total;
  const penalizedRating = breakdown.baseRating + pen;
  const penalizedRatingScore = Math.max(0, (penalizedRating - 6.0) * 15);
  const avail = breakdown.availability / 100;
  const ratingDelta = (penalizedRatingScore - breakdown.rating) * avail;
  return Math.max(0, breakdown.total + ratingDelta);
}

// ─── Enriched player ──────────────────────────────────────────────────────────

export interface EnrichedPlayer extends SquadPlayer {
  nextFixture: TeamFixture | null;
  analytics: PlayerAnalytics | null;
  odds: FixtureOdds | null;
  scoreBreakdown: ScoreBreakdown;
}

export function enrichPlayers(
  squad: SquadPlayer[],
  fixtures: Record<number, TeamFixture[]>,
  analyticsMap: Map<number, PlayerAnalytics>,
  oddsMap: Map<string, FixtureOdds | null>,
  formMap: Map<number, PlayerRecentMatch[]>,
): EnrichedPlayer[] {
  // Aggregate team form from the first available player per team (all share the same match results)
  const teamFormCache = new Map<number, TeamForm>();
  for (const p of squad) {
    if (!teamFormCache.has(p.teamId)) {
      teamFormCache.set(p.teamId, computeTeamForm(formMap.get(p.id) ?? []));
    }
  }

  return squad.map((p) => {
    const fix = fixtures[p.teamId]?.[0] ?? null;
    const analytics = analyticsMap.get(p.id) ?? null;
    const odds = fix ? (oddsMap.get(fix.matchId) ?? null) : null;
    const form = formMap.get(p.id) ?? [];
    const teamForm = teamFormCache.get(p.teamId) ?? { wins: 0, draws: 0, losses: 0, csRate: 0, matches: 0 };
    return { ...p, nextFixture: fix, analytics, odds, scoreBreakdown: calcScore(p, analytics, fix, odds, form, teamForm) };
  });
}

// ─── Module assignment ────────────────────────────────────────────────────────

export interface ModuleAssignment {
  /** Slot-ordered IDs: index 0 = GK, 1–10 = outfield slots. */
  ids: number[];
  /** Score penalty per slot (0 = native position, -1.5 or -3 = out of position). */
  penalty: number[];
}

export function assignModule(available: EnrichedPlayer[], slots: MantraPosition[][]): ModuleAssignment | null {
  const gks = available
    .filter((p) => effectivePositionGroup(p) === 'GK')
    .sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total);
  if (!gks[0]) return null;

  const used = new Set<number>([gks[0].id]);
  const outfield = available.filter((p) => effectivePositionGroup(p) !== 'GK');
  const result: (number | null)[] = new Array(slots.length).fill(null);
  const resultPenalty: (number | null)[] = new Array(slots.length).fill(null);
  const filled = new Set<number>();

  for (let round = 0; round < slots.length; round++) {
    // Pick the most-constrained unfilled slot: fewest native (0-penalty) candidates,
    // then fewest total candidates as tiebreaker.
    let bestSlotIdx = -1;
    let bestNative = Infinity;
    let bestTotal  = Infinity;
    for (let i = 0; i < slots.length; i++) {
      if (filled.has(i)) continue;
      const total = outfield.filter(
        (p) => !used.has(p.id) && getSlotPenalty(slots[i], p.mantraPositions) !== undefined,
      ).length;
      if (total === 0) return null;
      const native = outfield.filter(
        (p) => !used.has(p.id) && getSlotPenalty(slots[i], p.mantraPositions) === 0,
      ).length;
      if (native < bestNative || (native === bestNative && total < bestTotal)) {
        bestNative = native; bestTotal = total; bestSlotIdx = i;
      }
    }
    if (bestSlotIdx === -1) return null;

    const slotPositions = slots[bestSlotIdx];

    // Prefer native candidates (pen = 0); fall back to out-of-position only when
    // no native player is available for this slot.
    const natives = outfield
      .filter((p) => !used.has(p.id) && getSlotPenalty(slotPositions, p.mantraPositions) === 0)
      .sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total);

    if (natives.length > 0) {
      result[bestSlotIdx] = natives[0].id;
      resultPenalty[bestSlotIdx] = 0;
      used.add(natives[0].id);
    } else {
      const oop = outfield
        .filter((p) => !used.has(p.id) && getSlotPenalty(slotPositions, p.mantraPositions) !== undefined)
        .map((p) => ({ p, pen: getSlotPenalty(slotPositions, p.mantraPositions)! }))
        .sort((a, b) => effectiveScore(b.p.scoreBreakdown, b.pen) - effectiveScore(a.p.scoreBreakdown, a.pen));
      if (!oop[0]) return null;
      result[bestSlotIdx] = oop[0].p.id;
      resultPenalty[bestSlotIdx] = oop[0].pen;
      used.add(oop[0].p.id);
    }
    filled.add(bestSlotIdx);
  }

  if (result.some((r) => r === null)) return null;
  return {
    ids: [gks[0].id, ...(result as number[])],
    penalty: [0, ...(resultPenalty as number[])],
  };
}
