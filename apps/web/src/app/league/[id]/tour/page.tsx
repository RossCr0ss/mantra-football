'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import { ProgressBar } from '@/components/LoadingProgressBar';
import { LEAGUES } from '@/lib/fotmob';
import type { TeamFixture, FixtureOdds } from '@/lib/fotmob';
import type { SquadPlayer, PositionGroup, MantraPosition } from '@/types/squad';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import type { PlayerRecentMatch } from '@/lib/fotmob';

// ─── Scoring ──────────────────────────────────────────────────────────────────

function goalBonus(mantraPositions: MantraPosition[]): number {
  if (mantraPositions.includes('ST')) return 2;
  if (mantraPositions.includes('FW')) return 2.5;
  return 3;
}

function csBonus(mantraPositions: MantraPosition[]): number {
  const primary = mantraPositions[0];
  if (primary === 'GK') return 1.5;
  if (primary === 'RB' || primary === 'CB' || primary === 'LB') return 1;
  if (primary === 'WB' || primary === 'DM') return 0.5;
  return 0;
}

interface ScoreBreakdown {
  total: number;
  /** Raw analytics rating (e.g. 7.2) — stored so malus can be applied additively later */
  baseRating: number;
  /** ratingScore = max(0, (baseRating - 6.0) * 18) */
  rating: number;
  fixture: number;
  odds: number;
  position: number;
  minutes: number;
  availability: number;
}

/** Average rating from the last ≥3 recent matches that had playing time. */
function recentFormRating(form: PlayerRecentMatch[]): number | null {
  const rated = form
    .filter((m) => m.rating !== null && m.minutesPlayed !== null && m.minutesPlayed > 30)
    .slice(0, 5)
    .map((m) => m.rating as number);
  if (rated.length < 3) return null;
  return rated.reduce((s, r) => s + r, 0) / rated.length;
}

function calcScore(
  player: SquadPlayer,
  analytics: PlayerAnalytics | null,
  fix: TeamFixture | null,
  odds: FixtureOdds | null,
  form: PlayerRecentMatch[],
): ScoreBreakdown {
  if (isBlocked(player)) {
    return { total: -999, baseRating: 6.0, rating: 0, fixture: 0, odds: 0, position: 0, minutes: 0, availability: 0 };
  }

  const seasonRating = analytics?.rating ?? 6.0;
  const formRating = recentFormRating(form);
  // Blend: 60% season average + 40% recent form when enough form matches available
  const rating = formRating !== null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating;
  const ratingScore = Math.max(0, (rating - 6.0) * 18);

  const diff = fix?.difficulty ?? 3;
  const fixtureScore = (diff - 1) * 4;

  let oddsScore = 0;
  let winProb = 0;
  if (odds && fix) {
    const teamOdds = fix.isHome ? odds.home : odds.away;
    if (teamOdds && teamOdds > 1) {
      winProb = 1 / teamOdds;
      oddsScore = winProb * 15;
    }
  } else {
    winProb = diff * 0.1 - 0.05;
  }

  const matchesPlayed = analytics?.matchesPlayed ?? 0;
  const hasData = matchesPlayed > 3;
  const goals = analytics?.goals ?? 0;
  const assists = analytics?.assists ?? 0;
  // Use analytics.positionGroup which already reflects manual mantra positions
  const group = analytics?.positionGroup ?? player.positionGroup;
  const positions = player.mantraPositions ?? [];

  const gpg = hasData ? goals / matchesPlayed : 0;
  const apg = hasData ? assists / matchesPlayed : 0;

  // Returns per-match value, 0 when data is insufficient or stat is missing
  const pm = (v: number | null | undefined): number =>
    hasData && v != null ? v / matchesPlayed : 0;

  const baseCsProb = diff * 0.075 - 0.025;
  const csProb = winProb > 0 ? Math.min(0.55, baseCsProb + winProb * 0.15) : baseCsProb;

  let positionScore = 0;
  if (group === 'GK') {
    const actualCsRate = hasData && analytics?.cleanSheets != null
      ? analytics.cleanSheets / matchesPlayed : null;
    const effectiveCsProb = actualCsRate !== null
      ? csProb * 0.4 + actualCsRate * 0.6 : csProb;
    // Save % above 65 → each extra % is worth 0.1 pts (75% → +1.0, 80% → +1.5)
    const svPctBonus = analytics?.savePercentage != null
      ? Math.max(0, analytics.savePercentage - 65) * 0.1 : 0;
    positionScore = effectiveCsProb * csBonus(positions) * 12
      + pm(analytics?.saves) * 0.4
      + svPctBonus
      + pm(analytics?.goalsPrevented) * 3
      + pm(analytics?.highClaims) * 0.4
      - pm(analytics?.goalsConceded) * 0.2;
  } else if (group === 'DEF') {
    // Defensive actions per match — weighted by how directly they prevent scoring
    const defContrib = pm(analytics?.tackles)               * 0.8
                     + pm(analytics?.interceptions)         * 1.0
                     + pm(analytics?.clearances)            * 0.4
                     + pm(analytics?.blockedShots)          * 0.8
                     + pm(analytics?.possessionWonFinal3rd) * 0.5
                     + pm(analytics?.aerialsWon)            * 0.4
                     - pm(analytics?.dribbledPast)          * 0.5
                     - pm(analytics?.foulsCommitted)        * 0.25;
    positionScore = csProb * csBonus(positions) * 10
      + gpg * goalBonus(positions) * 6
      + apg * 4
      + defContrib;
  } else if (group === 'MID') {
    const xgPerMatch = hasData && analytics?.expectedGoals != null
      ? analytics.expectedGoals / matchesPlayed : gpg;
    const kpPerMatch = hasData && analytics?.chancesCreated != null
      ? analytics.chancesCreated / matchesPlayed : apg;
    // Defensive contribution rewards DMs/CMs; W/AMs naturally have low tackle counts (~0 delta)
    const defContrib = pm(analytics?.tackles) * 0.4 + pm(analytics?.interceptions) * 0.6;
    positionScore = xgPerMatch * goalBonus(positions) * 7
      + kpPerMatch * 5
      + pm(analytics?.shots) * 0.15
      + pm(analytics?.bigChancesCreated) * 4
      + pm(analytics?.successfulDribbles) * 0.3
      + defContrib;
  } else {
    // FWD
    const xgPerMatch = hasData && analytics?.expectedGoals != null
      ? analytics.expectedGoals / matchesPlayed : gpg;
    positionScore = xgPerMatch * goalBonus(positions) * 10
      + apg * 5
      + pm(analytics?.shots) * 0.25
      + pm(analytics?.bigChancesCreated) * 2
      + pm(analytics?.successfulDribbles) * 0.4
      + pm(analytics?.aerialsWon) * 0.3
      - pm(analytics?.bigChancesMissed) * 2.0;
  }

  const avgMin = matchesPlayed > 0 && analytics?.minutesPlayed
    ? analytics.minutesPlayed / matchesPlayed
    : null;
  let minutesScore = 0;
  if (avgMin !== null) {
    if (avgMin >= 82) minutesScore = 10;
    else if (avgMin >= 70) minutesScore = 7;
    else if (avgMin >= 55) minutesScore = 4;
    else if (avgMin >= 40) minutesScore = 1;
  }

  const noFixturePenalty = fix ? 0 : 25;

  const availPct = player.availabilityPct ?? 100;
  const baseTotal = ratingScore + fixtureScore + oddsScore + positionScore + minutesScore - noFixturePenalty;
  const total = Math.max(0, baseTotal) * (availPct / 100);

  return {
    total,
    baseRating: rating,
    rating: ratingScore,
    fixture: fixtureScore,
    odds: oddsScore,
    position: positionScore,
    minutes: minutesScore,
    availability: availPct,
  };
}

function scoreTier(score: number) {
  if (score >= 55) return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', ring: 'ring-emerald-500/40' };
  if (score >= 38) return { bg: 'bg-blue-500/20',    text: 'text-blue-300',    ring: 'ring-blue-500/40'    };
  if (score >= 22) return { bg: 'bg-white/8',         text: 'text-gray-300',   ring: 'ring-white/10'       };
  return                   { bg: 'bg-gray-800/60',    text: 'text-gray-500',   ring: 'ring-white/5'        };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBlocked(player: SquadPlayer): boolean {
  return player.lineupStatus === 'injured' || player.lineupStatus === 'suspended';
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const DIFF_STYLE: Record<number, { bg: string; text: string }> = {
  1: { bg: 'bg-red-600',    text: 'text-red-100'    },
  2: { bg: 'bg-orange-500', text: 'text-orange-950' },
  3: { bg: 'bg-yellow-500', text: 'text-yellow-950' },
  4: { bg: 'bg-green-500',  text: 'text-green-950'  },
  5: { bg: 'bg-green-700',  text: 'text-green-100'  },
};

const POSITION_ORDER: Record<PositionGroup, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const POSITION_SECTIONS: { group: PositionGroup; label: string }[] = [
  { group: 'GK',  label: 'Goalkeepers' },
  { group: 'DEF', label: 'Defenders'   },
  { group: 'MID', label: 'Midfielders' },
  { group: 'FWD', label: 'Forwards'    },
];

// ─── Modules ──────────────────────────────────────────────────────────────────

const MODULES: { name: string; slots: MantraPosition[][] }[] = [
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
const POSITION_MALUS: Record<MantraPosition, Partial<Record<MantraPosition, number>>> = {
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
function getSlotPenalty(slotPositions: MantraPosition[], playerPositions: MantraPosition[]): number | undefined {
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
function effectiveScore(breakdown: ScoreBreakdown, pen: number): number {
  if (pen === 0) return breakdown.total;
  const penalizedRating = breakdown.baseRating + pen;
  const penalizedRatingScore = Math.max(0, (penalizedRating - 6.0) * 18);
  const avail = breakdown.availability / 100;
  const ratingDelta = (penalizedRatingScore - breakdown.rating) * avail;
  return Math.max(0, breakdown.total + ratingDelta);
}

// ─── Enriched player ──────────────────────────────────────────────────────────

interface EnrichedPlayer extends SquadPlayer {
  nextFixture: TeamFixture | null;
  analytics: PlayerAnalytics | null;
  odds: FixtureOdds | null;
  scoreBreakdown: ScoreBreakdown;
}

function enrichPlayers(
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

interface ModuleAssignment {
  /** Slot-ordered IDs: index 0 = GK, 1–10 = outfield slots. */
  ids: number[];
  /** Score penalty per slot (0 = native position, -1.5 or -3 = out of position). */
  penalty: number[];
}

function assignModule(available: EnrichedPlayer[], slots: MantraPosition[][]): ModuleAssignment | null {
  const gks = available
    .filter((p) => p.positionGroup === 'GK')
    .sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total);
  if (!gks[0]) return null;

  const used = new Set<number>([gks[0].id]);
  const outfield = available.filter((p) => p.positionGroup !== 'GK');
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

// ─── Pitch view ───────────────────────────────────────────────────────────────

const GK_COORD: [number, number] = [50, 138];

/**
 * Explicit [x, y] pitch coordinates per outfield slot (indices 0–9, matching
 * each formation's `slots` array in MODULES).  ViewBox 100 × 154.
 * Attacking direction: top (y ≈ 0).  Defending end: bottom (y ≈ 154).
 */
const MODULE_SLOT_COORDS: Record<string, Array<[number, number]>> = {
  '3-4-3':   [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[12,35],[50,30],[88,35]],
  '3-4-1-2': [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[50,52],[35,28],[65,28]],
  '3-4-2-1': [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[32,52],[68,52],[50,28]],
  '3-5-2':   [[22,112],[50,115],[78,112],[10,78],[27,78],[50,78],[73,78],[90,78],[35,30],[65,30]],
  '3-5-1-1': [[22,112],[50,115],[78,112],[35,88],[65,88],[50,70],[10,70],[50,48],[90,70],[50,28]],
  '4-3-3':   [[82,112],[60,115],[40,115],[18,112],[25,80],[50,78],[75,80],[12,35],[50,30],[88,35]],
  '4-3-1-2': [[82,112],[60,115],[40,115],[18,112],[25,82],[50,80],[75,82],[50,58],[35,30],[65,30]],
  '4-4-2':   [[82,112],[60,115],[40,115],[18,112],[12,80],[35,78],[65,78],[88,80],[35,32],[65,32]],
  '4-1-4-1': [[82,112],[60,115],[40,115],[18,112],[50,90],[12,70],[35,68],[65,68],[88,70],[50,28]],
  '4-4-1-1': [[82,112],[60,115],[40,115],[18,112],[12,80],[35,78],[65,78],[88,80],[50,55],[50,28]],
  '4-2-3-1': [[82,112],[60,115],[40,115],[18,112],[38,88],[62,88],[15,60],[50,58],[85,60],[50,28]],
  '4-3-2-1': [[82,112],[60,115],[40,115],[18,112],[25,82],[50,80],[75,82],[30,55],[70,55],[50,28]],
};

/** Groups of outfield slot indices on the same formation line (for polyline connectors). */
function getFormationLines(moduleName: string): number[][] {
  const coords = MODULE_SLOT_COORDS[moduleName];
  if (!coords) return [];
  const Y_TOLERANCE = 14;
  const groups: number[][] = [];
  const assigned = new Set<number>();
  for (let i = 0; i < coords.length; i++) {
    if (assigned.has(i)) continue;
    const yi = coords[i][1];
    const group: number[] = [i];
    assigned.add(i);
    for (let j = i + 1; j < coords.length; j++) {
      if (!assigned.has(j) && Math.abs(coords[j][1] - yi) <= Y_TOLERANCE) {
        group.push(j);
        assigned.add(j);
      }
    }
    if (group.length > 1) {
      group.sort((a, b) => coords[a][0] - coords[b][0]);
      groups.push(group);
    }
  }
  return groups;
}

const GROUP_COLORS: Record<PositionGroup, { ring: string; dot: string; badge: string }> = {
  GK:  { ring: 'ring-yellow-400',  dot: 'bg-yellow-400',  badge: 'bg-yellow-500/75'  },
  DEF: { ring: 'ring-sky-400',     dot: 'bg-sky-400',     badge: 'bg-sky-600/75'     },
  MID: { ring: 'ring-emerald-400', dot: 'bg-emerald-400', badge: 'bg-emerald-600/75' },
  FWD: { ring: 'ring-orange-400',  dot: 'bg-orange-400',  badge: 'bg-orange-500/75'  },
};

function PitchView({
  slottedPlayers,
  moduleName,
  slotsPenalty,
  onRemove,
}: {
  slottedPlayers: EnrichedPlayer[];
  moduleName: string;
  slotsPenalty: number[];
  onRemove: (id: number) => void;
}) {
  const outfieldCoords = MODULE_SLOT_COORDS[moduleName] ?? [];
  const formationLines = getFormationLines(moduleName);
  const module = MODULES.find((m) => m.name === moduleName);

  return (
    <div className="mx-auto w-full max-w-sm sm:max-w-md">
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ paddingBottom: '154%' }}>

        {/* ── Pitch SVG ──────────────────────────────────────────────────── */}
        <svg viewBox="0 0 100 154" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="pv-grass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#1a6129" />
              <stop offset="50%"  stopColor="#1e7030" />
              <stop offset="100%" stopColor="#1a6129" />
            </linearGradient>
            <pattern id="pv-stripes" x="0" y="0" width="100" height="14" patternUnits="userSpaceOnUse">
              <rect x="0" y="0" width="100" height="7" fill="rgba(255,255,255,0.025)" />
            </pattern>
          </defs>

          {/* Field fill */}
          <rect x="0" y="0" width="100" height="154" fill="url(#pv-grass)" />
          <rect x="0" y="0" width="100" height="154" fill="url(#pv-stripes)" />

          {/* Pitch outline */}
          <rect x="2" y="2" width="96" height="150" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.5" />

          {/* Corner arcs */}
          <path d="M 2 9 A 7 7 0 0 0 9 2"       fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 93 2 A 7 7 0 0 1 98 9"     fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 2 145 A 7 7 0 0 1 9 152"   fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 93 152 A 7 7 0 0 0 98 145" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />

          {/* Centre line + circle + spot */}
          <line x1="2" y1="77" x2="98" y2="77" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
          <circle cx="50" cy="77" r="10"  fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.4" />
          <circle cx="50" cy="77" r="0.8" fill="rgba(255,255,255,0.5)" />

          {/* Opponent end (top) */}
          <rect x="24" y="2" width="52" height="22" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
          <rect x="37" y="2" width="26" height="8"  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.35" />
          <circle cx="50" cy="18" r="0.7" fill="rgba(255,255,255,0.35)" />
          <path d="M 43 24 A 10 10 0 0 1 57 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />
          <rect x="41" y="0.5" width="18" height="2" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />

          {/* Our end (bottom) */}
          <rect x="24" y="130" width="52" height="22" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
          <rect x="37" y="144" width="26" height="8"  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.35" />
          <circle cx="50" cy="136" r="0.7" fill="rgba(255,255,255,0.35)" />
          <path d="M 43 130 A 10 10 0 0 0 57 130" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />
          <rect x="41" y="151.5" width="18" height="2" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />

          {/* Formation connecting lines */}
          {formationLines.map((group, gi) => (
            <polyline
              key={gi}
              points={group.map((si) => `${outfieldCoords[si][0]},${outfieldCoords[si][1]}`).join(' ')}
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="0.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 1.5"
            />
          ))}
        </svg>

        {/* ── Player tokens ──────────────────────────────────────────────── */}
        {slottedPlayers.map((player, slotIdx) => {
          const isGK = slotIdx === 0;
          const [cx, cy] = isGK ? GK_COORD : (outfieldCoords[slotIdx - 1] ?? [50, 77] as [number, number]);
          const pen        = slotsPenalty[slotIdx] ?? 0;
          const display    = effectiveScore(player.scoreBreakdown, pen);
          const tier       = scoreTier(display);
          const colors     = GROUP_COLORS[player.positionGroup];
          const slotDef    = isGK ? ['GK'] : (module?.slots[slotIdx - 1] ?? []);
          const roleLabel  = slotDef[0] ?? '';

          return (
            <button
              key={player.id}
              onClick={() => onRemove(player.id)}
              title={`${player.name}${pen < 0 ? ` (out of position: ${pen})` : ''} — click to remove`}
              className="group absolute flex flex-col items-center"
              style={{ left: `${cx}%`, top: `${(cy / 154) * 100}%`, transform: 'translate(-50%, -50%)' }}
            >
              {/* Score chip — shows penalized score when out of position */}
              <span className={`mb-0.5 rounded px-1 text-[7px] font-bold tabular-nums leading-4 ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
                {Math.round(display)}
              </span>

              {/* Avatar + hover overlay */}
              <div className={`relative overflow-hidden rounded-full ring-2 transition-all group-hover:ring-red-400 ${isGK ? 'h-9 w-9' : 'h-8 w-8'} ${colors.ring}`}>
                <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
                <div className="absolute inset-0 flex items-center justify-center bg-red-600/0 transition-all group-hover:bg-red-600/80">
                  <span className="text-xs font-bold text-transparent transition-all group-hover:text-white">✕</span>
                </div>
              </div>

              {/* Name pill */}
              <div className="mt-0.5 max-w-[60px] rounded bg-black/70 px-1">
                <p className="truncate text-center text-[7px] font-semibold leading-4 text-white">
                  {player.name.split(' ').pop()}
                </p>
              </div>

              {/* Slot role badge + out-of-position penalty */}
              <div className="flex items-center gap-0.5">
                {roleLabel && (
                  <span className={`rounded px-0.5 text-[6px] font-bold leading-3 text-white ${colors.badge}`}>
                    {roleLabel}
                  </span>
                )}
                {pen < 0 && (
                  <span className={`rounded px-0.5 text-[6px] font-bold leading-3 ${pen <= -3 ? 'bg-orange-600/80 text-orange-100' : 'bg-yellow-600/80 text-yellow-100'}`}>
                    {pen}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {(Object.keys(GROUP_COLORS) as PositionGroup[]).map((g) => (
          <span key={g} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className={`inline-block h-2 w-2 rounded-full ${GROUP_COLORS[g].dot}`} />
            {g}
          </span>
        ))}
        <span className="ml-2 text-xs font-semibold text-gray-400">{moduleName}</span>
      </div>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function TourSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-3">
        <div className="h-5 w-40 rounded bg-gray-700" />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/8 bg-gray-800 p-3 space-y-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-gray-700" />
              <div className="h-3 w-full rounded bg-gray-700" />
              <div className="h-3 w-3/4 mx-auto rounded bg-gray-800" />
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

// ─── Starting XI card (prominent) ────────────────────────────────────────────

function MainCard({ player, onRemove }: { player: EnrichedPlayer; onRemove: () => void }) {
  const fix = player.nextFixture;
  const diff = fix?.difficulty ?? null;
  const ds = diff !== null ? (DIFF_STYLE[diff] ?? DIFF_STYLE[3]) : null;
  const sb = player.scoreBreakdown;
  const tier = scoreTier(sb.total);

  return (
    <button
      onClick={onRemove}
      title="Click to remove from Starting XI"
      className="group relative flex flex-col items-center gap-1.5 rounded-xl border border-white/25 bg-white/6 p-3 text-center ring-1 ring-white/10 transition hover:border-white/40 hover:bg-white/10"
    >
      {/* Score badge */}
      <span className={`absolute top-2 right-2 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
        {Math.round(sb.total)}
      </span>

      {/* Remove hint */}
      <span className="absolute top-2 left-2 rounded bg-red-600/0 px-1 py-0.5 text-[10px] font-bold text-red-400/0 transition group-hover:bg-red-600/80 group-hover:text-white">
        ✕
      </span>

      {/* Photo */}
      <div className="relative mt-3 h-14 w-14 overflow-hidden rounded-full bg-gray-700 ring-2 ring-white/20">
        <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
      </div>

      {/* Name */}
      <p className="w-full truncate text-xs font-semibold text-white leading-tight">
        {player.name}
      </p>
      <p className="w-full truncate text-[10px] text-gray-500">{player.teamName}</p>

      {/* Mantra positions */}
      {player.mantraPositions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-0.5">
          {player.mantraPositions.slice(0, 2).map((pos) => (
            <span key={pos} className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-bold text-gray-300">
              {pos}
            </span>
          ))}
        </div>
      )}

      {/* Fixture */}
      {fix && ds ? (
        <div className={`w-full rounded-lg px-1.5 py-1 text-center ${ds.bg} ${ds.text}`}>
          <p className="truncate text-[10px] font-semibold">
            {fix.isHome ? 'vs' : '@'} {fix.opponent.name}
          </p>
        </div>
      ) : (
        <div className="w-full rounded-lg bg-gray-800 px-1.5 py-1">
          <p className="text-[10px] text-gray-600">No fixture</p>
        </div>
      )}
    </button>
  );
}

// ─── Squad player row (compact) ───────────────────────────────────────────────

function SquadRow({
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
  const ds = diff !== null ? (DIFF_STYLE[diff] ?? DIFF_STYLE[3]) : null;
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
        <p className="truncate text-[11px] text-gray-600">{player.teamName}</p>
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

      {/* Score */}
      <span className={`ml-auto shrink-0 rounded px-2 py-1 text-xs font-bold tabular-nums ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
        {blocked ? '—' : Math.round(sb.total)}
      </span>
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatBadge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold tabular-nums ${ok ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TourPage() {
  const params = useParams<{ id: string }>();
  const leagueId = Number(params.id);
  const league = LEAGUES.find((l) => l.id === leagueId);

  const [players, setPlayers] = useState<EnrichedPlayer[]>([]);
  const [loadingMain, setLoadingMain] = useState(true);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [mainIds, setMainIds] = useState<Set<number>>(new Set());
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [appliedModule, setAppliedModule] = useState<string | null>(null);
  /** Slot-ordered IDs from the last auto-select (index 0 = GK, 1-10 = outfield slots). */
  const [mainSlots, setMainSlots] = useState<number[]>([]);
  /** Score penalty per slot from the last auto-select (0 = native, -1.5 or -3 = out of position). */
  const [mainSlotsPenalty, setMainSlotsPenalty] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'tactics'>('grid');
  const autoSelectedRef = useRef(false);
  const [isCalculating, startCalculation] = useTransition();

  const [fixtures, setFixtures]     = useState<Record<number, TeamFixture[]>>({});
  const [analyticsMap, setAnalyticsMap] = useState<Map<number, PlayerAnalytics>>(new Map());
  const [oddsMap, setOddsMap]       = useState<Map<string, FixtureOdds | null>>(new Map());
  const [formMap, setFormMap]       = useState<Map<number, PlayerRecentMatch[]>>(new Map());
  const [squad, setSquad]           = useState<SquadPlayer[]>([]);

  useEffect(() => {
    if (squad.length === 0) return;
    setPlayers(enrichPlayers(squad, fixtures, analyticsMap, oddsMap, formMap));
  }, [squad, fixtures, analyticsMap, oddsMap, formMap]);

  // Auto-select once when players first load
  useEffect(() => {
    if (players.length === 0 || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    autoSelect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  // Re-run auto-select when formation chip changes (only after initial load)
  useEffect(() => {
    if (!autoSelectedRef.current || players.length === 0) return;
    autoSelect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/squad?leagueId=${leagueId}`).then((r) => r.json()),
      fetch(`/api/leagues/${leagueId}/fixtures`).then((r) => r.json()),
      fetch(`/api/leagues/${leagueId}/analytics`).then((r) => r.json()),
    ]).then(([squadData, fixtureData, analyticsData]) => {
      const loadedSquad: SquadPlayer[] = squadData.players ?? [];
      const loadedFixtures: Record<number, TeamFixture[]> = fixtureData.fixtures ?? {};
      const loadedAnalytics: PlayerAnalytics[] = analyticsData.players ?? [];

      const aMap = new Map<number, PlayerAnalytics>();
      for (const a of loadedAnalytics) aMap.set(a.playerId, a);

      setSquad(loadedSquad);
      setFixtures(loadedFixtures);
      setAnalyticsMap(aMap);

      setLoadingMain(false);

      const uniqueMatchIds = Array.from(
        new Set(Object.values(loadedFixtures).flat().map((f) => f.matchId)),
      );
      if (uniqueMatchIds.length > 0) {
        setLoadingOdds(true);
        Promise.all(
          uniqueMatchIds.map((id) =>
            fetch(`/api/matches/${id}/odds`)
              .then((r) => r.json())
              .then((d) => [id, (d.odds as FixtureOdds | null)] as const)
              .catch(() => [id, null] as const),
          ),
        ).then((entries) => setOddsMap(new Map(entries)))
          .finally(() => setLoadingOdds(false));
      }

      fetch(`/api/leagues/${leagueId}/form`)
        .then((r) => r.json())
        .then((d) => {
          const fMap = new Map<number, PlayerRecentMatch[]>();
          for (const [k, v] of Object.entries(d.form ?? {})) {
            fMap.set(Number(k), v as PlayerRecentMatch[]);
          }
          setFormMap(fMap);
        })
        .catch(() => {});
    }).catch(() => setLoadingMain(false));
  }, [leagueId]);

  // ── Auto-select ───────────────────────────────────────────────────────────────
  function autoSelect() {
    const available = players.filter((p) => !isBlocked(p));
    let best: ModuleAssignment | null = null;
    let chosenModuleName: string | null = null;

    if (selectedModule) {
      const mod = MODULES.find((m) => m.name === selectedModule);
      if (mod) { best = assignModule(available, mod.slots); chosenModuleName = mod.name; }
    } else {
      // Primary criterion: fewest out-of-position slots (OOP is a last resort).
      // Secondary criterion: highest total effective score (with malus applied).
      let bestOop = Infinity;
      let bestScore = -Infinity;
      for (const mod of MODULES) {
        const assignment = assignModule(available, mod.slots);
        if (!assignment) continue;
        const oopCount = assignment.penalty.filter((p) => p < 0).length;
        const score = assignment.ids.reduce((sum, id, i) => {
          const p = available.find((pl) => pl.id === id);
          const sb = p?.scoreBreakdown;
          return sum + (sb ? effectiveScore(sb, assignment.penalty[i]) : 0);
        }, 0);
        if (oopCount < bestOop || (oopCount === bestOop && score > bestScore)) {
          bestOop = oopCount; bestScore = score; best = assignment; chosenModuleName = mod.name;
        }
      }
    }

    if (!best) return;
    const { ids, penalty } = best;
    startCalculation(() => {
      setMainIds(new Set<number>(ids));
      setAppliedModule(chosenModuleName);
      setMainSlots(ids);
      setMainSlotsPenalty(penalty);
      setViewMode('tactics');
    });
  }

  function togglePlayer(playerId: number) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    // Manual edits invalidate slot assignments → fall back to grid view
    setMainSlots([]);
    setViewMode('grid');
    if (mainIds.has(playerId)) {
      setMainIds((prev) => { const n = new Set(prev); n.delete(playerId); return n; });
    } else {
      if (isBlocked(player) || mainIds.size >= 11) return;
      setMainIds((prev) => new Set(Array.from(prev).concat(playerId)));
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────────
  const mainCount    = mainIds.size;
  const gkMainCount  = players.filter((p) => mainIds.has(p.id) && p.positionGroup === 'GK').length;
  const isValid      = mainCount === 11 && gkMainCount === 1;
  // Use per-slot effective scores (with malus) when auto-select has run; raw totals otherwise.
  const estimatedTotal = mainSlots.length === 11
    ? mainSlots.reduce((sum, id, i) => {
        const p = players.find((pl) => pl.id === id);
        const pen = mainSlotsPenalty[i] ?? 0;
        return sum + (p ? effectiveScore(p.scoreBreakdown, pen) : 0);
      }, 0)
    : players.filter((p) => mainIds.has(p.id)).reduce((sum, p) => sum + p.scoreBreakdown.total, 0);

  const mainPlayers = players
    .filter((p) => mainIds.has(p.id))
    .sort((a, b) => POSITION_ORDER[a.positionGroup] - POSITION_ORDER[b.positionGroup]);

  const canShowTactics = mainSlots.length === 11 && appliedModule !== null;
  // Build a lookup once so the map below is O(1) per entry, not O(n)
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const slottedPlayers: EnrichedPlayer[] = useMemo(
    () => (canShowTactics ? mainSlots.map((id) => playerById.get(id)).filter((p): p is EnrichedPlayer => p != null) : []),
    [canShowTactics, mainSlots, playerById],
  );

  const firstFix  = players.find((p) => p.nextFixture)?.nextFixture;
  const roundLabel = firstFix?.round ? `Round ${firstFix.round}` : null;

  return (
    <>
    <ProgressBar loading={loadingMain} />
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-5xl space-y-6">

        <Breadcrumbs />

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {league && (
              <div className="relative h-10 w-10 shrink-0">
                <Image src={league.logoUrl} alt={league.name} fill className="object-contain" unoptimized />
              </div>
            )}
            <div>
              <p className="text-sm text-gray-400">
                {league?.country}{roundLabel ? ` · ${roundLabel}` : ''}
              </p>
              <h1 className="text-2xl font-bold text-white">Tour Selector</h1>
            </div>
          </div>
          <button
            onClick={autoSelect}
            disabled={loadingMain || players.length === 0}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-200 disabled:opacity-40"
          >
            {isCalculating && (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-gray-900 animate-spin" />
            )}
            Auto-select
          </button>
        </div>

        {/* Status bar */}
        <div className={`flex flex-wrap items-center gap-5 rounded-2xl border px-5 py-4 ${
          isValid ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-white/8 bg-gray-900'
        }`}>
          <StatBadge label="Starting XI" value={`${mainCount} / 11`} ok={mainCount === 11} />
          <StatBadge label="GK" value={`${gkMainCount} / 1`} ok={gkMainCount === 1} />
          {mainCount > 0 && (
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-gray-300">{Math.round(estimatedTotal)}</p>
              <p className="text-[10px] text-gray-500">Est. score</p>
            </div>
          )}
          {appliedModule && (
            <div className="text-center">
              <p className="text-lg font-bold text-gray-300">{appliedModule}</p>
              <p className="text-[10px] text-gray-500">{selectedModule ? 'Formation' : 'Best formation'}</p>
            </div>
          )}
          {isValid && (
            <span className="ml-auto rounded-lg bg-emerald-900/60 px-3 py-1.5 text-sm font-semibold text-emerald-400">
              Ready ✓
            </span>
          )}
        </div>

        <LeagueNav leagueId={leagueId} />

        {/* Formation chips */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Formation</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedModule(null)}
              className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                selectedModule === null
                  ? 'border-white/40 bg-white/12 text-white'
                  : 'border-white/8 bg-gray-900 text-gray-500 hover:border-white/15 hover:text-gray-300'
              }`}
            >
              Best
            </button>
            {MODULES.map((mod) => (
              <button
                key={mod.name}
                onClick={() => setSelectedModule(mod.name)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                  selectedModule === mod.name
                    ? 'border-white/40 bg-white/12 text-white'
                    : 'border-white/8 bg-gray-900 text-gray-500 hover:border-white/15 hover:text-gray-300'
                }`}
              >
                {mod.name}
              </button>
            ))}
          </div>
        </div>
        {isCalculating && (
          <p className="text-xs text-gray-500 animate-pulse">Calculating best XI…</p>
        )}

        {loadingMain ? (
          <TourSkeleton />
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-16 text-center">
            <p className="text-gray-400">No squad saved yet.</p>
            <Link href={`/league/${leagueId}`} className="mt-4 inline-block rounded-xl bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20">
              Build Squad
            </Link>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── Starting XI ──────────────────────────────────────────────── */}
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Starting XI</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                  mainCount === 11 ? 'bg-emerald-900/60 text-emerald-400' : 'bg-gray-800 text-gray-400'
                }`}>{mainCount}/11</span>
                {mainCount < 11 && (
                  <span className="text-xs text-gray-600">Click a player below to add · click a card to remove</span>
                )}

                {/* View toggle — only available after auto-select */}
                {canShowTactics && (
                  <div className="ml-auto flex gap-0.5 rounded-lg border border-white/8 bg-gray-900 p-0.5">
                    {(['grid', 'tactics'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`rounded px-3 py-1 text-xs font-semibold capitalize transition ${
                          viewMode === mode
                            ? 'bg-white text-gray-900'
                            : 'text-gray-500 hover:text-white'
                        }`}
                      >
                        {mode === 'tactics' ? 'Tactics' : 'Grid'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {mainPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-gray-900/40 py-10 text-center">
                  <p className="text-sm text-gray-600">No players selected — press Auto-select or click players below</p>
                </div>
              ) : viewMode === 'tactics' && canShowTactics ? (
                <PitchView
                  slottedPlayers={slottedPlayers}
                  moduleName={appliedModule!}
                  slotsPenalty={mainSlotsPenalty}
                  onRemove={togglePlayer}
                />
              ) : (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {mainPlayers.map((p) => (
                    <MainCard key={p.id} player={p} onRemove={() => togglePlayer(p.id)} />
                  ))}
                  {/* Empty slot placeholders */}
                  {mainCount < 11 && Array.from({ length: 11 - mainCount }).map((_, i) => (
                    <div key={`empty-${i}`} className="rounded-xl border border-dashed border-white/8 bg-transparent py-8 flex items-center justify-center">
                      <span className="text-xs text-gray-700">+</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Squad ────────────────────────────────────────────────────── */}
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Your Squad</h2>
                <span className="text-xs text-gray-600">· Score legend:</span>
                {[
                  { label: '55+ Elite', cls: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' },
                  { label: '38+ Good',  cls: 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40'         },
                  { label: '22+ Avg',   cls: 'bg-white/8 text-gray-300 ring-1 ring-white/10'                },
                ].map((t) => (
                  <span key={t.label} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.cls}`}>{t.label}</span>
                ))}
              </div>

              {POSITION_SECTIONS.map(({ group, label }) => {
                const groupPlayers = players
                  .filter((p) => p.positionGroup === group)
                  .sort((a, b) => {
                    const rank = (p: EnrichedPlayer) =>
                      mainIds.has(p.id) ? 0 :
                      isBlocked(p) ? 3 :
                      (p.availabilityPct ?? 100) < 100 ? 2 : 1;
                    const rd = rank(a) - rank(b);
                    if (rd !== 0) return rd;
                    return b.scoreBreakdown.total - a.scoreBreakdown.total;
                  });
                if (!groupPlayers.length) return null;

                return (
                  <div key={group}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {label} <span className="text-gray-700">({groupPlayers.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {groupPlayers.map((player) => (
                        <SquadRow
                          key={player.id}
                          player={player}
                          isMain={mainIds.has(player.id)}
                          onToggle={() => togglePlayer(player.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

          </div>
        )}
      </div>
    </main>
    </>
  );
}
