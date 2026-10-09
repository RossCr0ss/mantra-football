import type { SquadPlayer, MantraPosition } from '@/types/squad';
import type { TeamFixture, FixtureOdds, PlayerRecentMatch } from '@/lib/fotmob';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { effectivePositionGroup } from '@/lib/positionGroups';
import { calcScore, SCORE_UNITS_PER_MANTRA_POINT, type ScoreBreakdown } from '@/lib/tourScoring';

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
 * Applies the position malus: in the real game it is subtracted from the player's match score, so an
 * out-of-position player is worth `pen` Mantra points less (only when he plays → × start probability).
 * Floored at 0 like every score.
 *
 *   pen  0   → no change
 *   pen -1.5 → total − 1.5 × SCORE_UNITS_PER_MANTRA_POINT × startProb
 */
export function effectiveScore(breakdown: ScoreBreakdown, pen: number): number {
  if (pen === 0) return breakdown.total;
  return Math.max(0, breakdown.total + pen * SCORE_UNITS_PER_MANTRA_POINT * breakdown.startProb);
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
  return squad.map((p) => {
    const fix = fixtures[p.teamId]?.[0] ?? null;
    const analytics = analyticsMap.get(p.id) ?? null;
    const odds = fix ? (oddsMap.get(fix.matchId) ?? null) : null;
    const form = formMap.get(p.id) ?? [];
    return { ...p, nextFixture: fix, analytics, odds, scoreBreakdown: calcScore(p, analytics, fix, odds, form) };
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

// ─── Defence bonus & module choice ────────────────────────────────────────────

/** The defence bonus (0–5 Mantra points) is converted at the same rate as player scores (`SCORE_UNITS_PER_MANTRA_POINT`, defined in tourScoring.ts). */
export { SCORE_UNITS_PER_MANTRA_POINT };

/**
 * Team defence bonus from the average BASE score of the module's defenders (official rules,
 * mantrafootball.org/rules): <7.00 → 0, 7.00–7.24 → 1, 7.25–7.49 → 2, … ≥8.00 → 5.
 */
export function defenceBonusPoints(avgBaseRating: number): number {
  if (avgBaseRating < 7) return 0;
  return Math.min(5, Math.floor((avgBaseRating - 7) / 0.25 + 1e-9) + 1);
}

const BACK_LINE: ReadonlySet<MantraPosition> = new Set<MantraPosition>(['RB', 'CB', 'LB']);

/**
 * Indexes (into `slots`, i.e. outfield slot order) of the module's defenders: slots that only
 * accept RB/CB/LB. Wing-back (WB) slots are NOT counted — assumption: Mantra's "defensive
 * positions in the module" means the back line (3 in 3-x-x, 4 in 4-x-x). Verify against the rules page.
 */
export function defenderSlotIndexes(slots: MantraPosition[][]): number[] {
  return slots.flatMap((s, i) => (s.every((p) => BACK_LINE.has(p)) ? [i] : []));
}

/** Defence bonus (Mantra points) for an assignment: average unpenalised base rating of the defenders. */
export function assignmentDefenceBonus(
  assignment: ModuleAssignment,
  byId: Map<number, EnrichedPlayer>,
  slots: MantraPosition[][],
): number {
  const idx = defenderSlotIndexes(slots);
  if (idx.length === 0) return 0;
  // ids[0] is the GK, outfield slot i is ids[i + 1]. The malus does not affect the defence bonus.
  const ratings = idx.map((i) => byId.get(assignment.ids[i + 1])?.scoreBreakdown.baseRating ?? 6);
  return defenceBonusPoints(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

/** Total effective score of an assignment (GK + 10 slots, malus applied) plus the defence bonus. */
export function assignmentScore(
  assignment: ModuleAssignment,
  byId: Map<number, EnrichedPlayer>,
  slots: MantraPosition[][],
): number {
  const players = assignment.ids.reduce((sum, id, i) => {
    const sb = byId.get(id)?.scoreBreakdown;
    return sum + (sb ? effectiveScore(sb, assignment.penalty[i]) : 0);
  }, 0);
  return players + assignmentDefenceBonus(assignment, byId, slots) * SCORE_UNITS_PER_MANTRA_POINT;
}

/**
 * Hill-climbs an assignment on `assignmentScore` (effective scores + defence bonus). The greedy
 * `assignModule` cannot see the bonus tiers, e.g. that swapping one back-line player for a slightly
 * lower-scored but higher-rated one lifts the average to the next tier. Moves: replace a slot's
 * player with an unused eligible one, or swap two slots' players. Only strict improvements are
 * taken, so the result is never worse than the input; the GK slot is untouched.
 */
export function improveAssignment(
  assignment: ModuleAssignment,
  available: EnrichedPlayer[],
  slots: MantraPosition[][],
  maxIterations = 50,
): ModuleAssignment {
  const byId = new Map(available.map((p) => [p.id, p]));
  let ids = [...assignment.ids];
  let penalty = [...assignment.penalty];
  let current = assignmentScore({ ids, penalty }, byId, slots);

  for (let iter = 0; iter < maxIterations; iter++) {
    let bestGain = 1e-9;
    let best: { ids: number[]; penalty: number[] } | null = null;
    const used = new Set(ids);

    const consider = (nextIds: number[], nextPen: number[]) => {
      const gain = assignmentScore({ ids: nextIds, penalty: nextPen }, byId, slots) - current;
      if (gain > bestGain) { bestGain = gain; best = { ids: nextIds, penalty: nextPen }; }
    };

    for (let s = 0; s < slots.length; s++) {
      for (const cand of available) {
        if (used.has(cand.id)) continue;
        const pen = getSlotPenalty(slots[s], cand.mantraPositions);
        if (pen === undefined) continue;
        const nextIds = [...ids]; const nextPen = [...penalty];
        nextIds[s + 1] = cand.id; nextPen[s + 1] = pen;
        consider(nextIds, nextPen);
      }
      for (let t = s + 1; t < slots.length; t++) {
        const a = byId.get(ids[s + 1]); const b = byId.get(ids[t + 1]);
        if (!a || !b) continue;
        const penA = getSlotPenalty(slots[t], a.mantraPositions);  // a moves to slot t
        const penB = getSlotPenalty(slots[s], b.mantraPositions);  // b moves to slot s
        if (penA === undefined || penB === undefined) continue;
        const nextIds = [...ids]; const nextPen = [...penalty];
        nextIds[s + 1] = b.id; nextIds[t + 1] = a.id;
        nextPen[s + 1] = penB; nextPen[t + 1] = penA;
        consider(nextIds, nextPen);
      }
    }

    if (!best) break;
    ({ ids, penalty } = best as { ids: number[]; penalty: number[] });
    current += bestGain;
  }
  return { ids, penalty };
}

/**
 * Picks the formation for auto-select. A pinned module name is used as-is (null if infeasible);
 * otherwise every module is assigned and the highest `assignmentScore` wins.
 */
export function pickBestModule(
  available: EnrichedPlayer[],
  pinnedName: string | null = null,
): { moduleName: string; assignment: ModuleAssignment; defenceBonus: number } | null {
  const byId = new Map(available.map((p) => [p.id, p]));
  const candidates = pinnedName ? MODULES.filter((m) => m.name === pinnedName) : MODULES;

  let best: { moduleName: string; assignment: ModuleAssignment; defenceBonus: number } | null = null;
  let bestScore = -Infinity;
  for (const mod of candidates) {
    const greedy = assignModule(available, mod.slots);
    if (!greedy) continue;
    const assignment = improveAssignment(greedy, available, mod.slots);
    const score = assignmentScore(assignment, byId, mod.slots);
    if (score > bestScore) {
      bestScore = score;
      best = { moduleName: mod.name, assignment, defenceBonus: assignmentDefenceBonus(assignment, byId, mod.slots) };
    }
  }
  return best;
}
