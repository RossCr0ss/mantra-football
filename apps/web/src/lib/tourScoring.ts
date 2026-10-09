import type { SquadPlayer, MantraPosition } from '@/types/squad';
import type { TeamFixture, FixtureOdds, PlayerRecentMatch } from '@/lib/fotmob';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { effectivePositionGroup } from '@/lib/positionGroups';

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function goalBonus(mantraPositions: MantraPosition[]): number {
  if (mantraPositions.includes('ST')) return 2;
  if (mantraPositions.includes('FW')) return 2.5;
  return 3;
}

export function csBonus(mantraPositions: MantraPosition[]): number {
  const primary = mantraPositions[0];
  if (primary === 'GK') return 1.5;
  if (primary === 'RB' || primary === 'CB' || primary === 'LB') return 1;
  if (primary === 'WB' || primary === 'DM') return 0.5;
  return 0;
}

export interface ScoreBreakdown {
  total: number;
  /** Raw analytics rating (e.g. 7.2) — stored so malus can be applied additively later */
  baseRating: number;
  /** ratingScore = max(0, (baseRating - 6.0) * 15) */
  rating: number;
  fixture: number;
  odds: number;
  position: number;
  minutes: number;
  /** Team form momentum: +4 for winning streak, −4 for losing streak (last 5 matches) */
  form: number;
  availability: number;
}

/** Average rating from the last ≥3 recent matches that had playing time. */
export function recentFormRating(form: PlayerRecentMatch[]): number | null {
  const rated = form
    .filter((m) => m.rating !== null && m.minutesPlayed !== null && m.minutesPlayed > 30)
    .slice(0, 5)
    .map((m) => m.rating as number);
  if (rated.length < 3) return null;
  return rated.reduce((s, r) => s + r, 0) / rated.length;
}

export interface TeamForm {
  wins: number;
  draws: number;
  losses: number;
  csRate: number;
  matches: number;
}

export function computeTeamForm(form: PlayerRecentMatch[]): TeamForm {
  const recent = form.filter((m) => m.result !== null).slice(0, 5);
  if (recent.length === 0) return { wins: 0, draws: 0, losses: 0, csRate: 0, matches: 0 };
  const wins   = recent.filter((m) => m.result === 'W').length;
  const draws  = recent.filter((m) => m.result === 'D').length;
  const losses = recent.filter((m) => m.result === 'L').length;
  const cs     = recent.filter((m) => (m.goalsAgainst ?? 1) === 0).length;
  return { wins, draws, losses, csRate: cs / recent.length, matches: recent.length };
}

export function calcScore(
  player: SquadPlayer,
  analytics: PlayerAnalytics | null,
  fix: TeamFixture | null,
  odds: FixtureOdds | null,
  form: PlayerRecentMatch[],
  teamForm: TeamForm,
): ScoreBreakdown {
  if (isBlocked(player)) {
    return { total: -999, baseRating: 6.0, rating: 0, fixture: 0, odds: 0, position: 0, minutes: 0, form: 0, availability: 0 };
  }

  const matchesPlayed = analytics?.matchesPlayed ?? 0;
  const prior = analytics?.priorSeason ?? null;
  const priorMatches = prior?.matchesPlayed ?? 0;
  // Confidence in current-season data ramps from 0 to full trust over its first
  // 4 matches (matches the old "matchesPlayed > 3" cutoff), instead of a hard
  // switch — early in a new season every player's current-season stats are
  // 0/null, which used to make every player score identically until match 4.
  const wConf = Math.min(1, matchesPlayed / 4);

  // Blends a counting stat's per-match rate between current season (weighted by
  // wConf) and last season, so early-season players (new signings, players back
  // from injury, or just gameweek 1) aren't scored on zero signal alone.
  const pm = (curTotal: number | null | undefined, priorTotal: number | null | undefined): number => {
    const curRate = matchesPlayed > 0 && curTotal != null ? curTotal / matchesPlayed : null;
    const priorRate = priorMatches > 0 && priorTotal != null ? priorTotal / priorMatches : null;
    if (curRate == null) return priorRate ?? 0;
    if (priorRate == null) return curRate;
    return curRate * wConf + priorRate * (1 - wConf);
  };
  // Like pm(), but falls back to a proxy stat (e.g. goals/match) only when
  // neither season has real data for this stat at all.
  const pmOr = (
    curTotal: number | null | undefined, priorTotal: number | null | undefined, fallback: number,
  ): number => (curTotal != null || priorTotal != null ? pm(curTotal, priorTotal) : fallback);

  const curRating = analytics?.rating ?? null;
  const priorRating = prior?.rating ?? null;
  const seasonRating = curRating != null && priorRating != null
    ? curRating * wConf + priorRating * (1 - wConf)
    : curRating ?? priorRating ?? 6.0;
  const formRating = recentFormRating(form);
  // Blend: 60% season average + 40% recent form when enough form matches available
  const rating = formRating !== null ? seasonRating * 0.6 + formRating * 0.4 : seasonRating;
  const ratingScore = Math.max(0, (rating - 6.0) * 15);

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

  const group = analytics?.positionGroup ?? effectivePositionGroup(player);
  const positions = player.mantraPositions ?? [];

  const gpg = pm(analytics?.goals, prior?.goals);
  const apg = pm(analytics?.assists, prior?.assists);

  // Blend odds-based CS probability with actual team CS rate from recent form
  const baseCsProb = diff * 0.075 - 0.025;
  const csFromOdds = winProb > 0 ? Math.min(0.55, baseCsProb + winProb * 0.15) : baseCsProb;
  const csProb = teamForm.matches >= 3
    ? csFromOdds * 0.5 + teamForm.csRate * 0.5
    : csFromOdds;

  let positionScore = 0;
  if (group === 'GK') {
    const hasCsData = (matchesPlayed > 0 && analytics?.cleanSheets != null)
      || (priorMatches > 0 && prior?.cleanSheets != null);
    const actualCsRate = hasCsData ? pm(analytics?.cleanSheets, prior?.cleanSheets) : null;
    const effectiveCsProb = actualCsRate !== null
      ? csProb * 0.4 + actualCsRate * 0.6 : csProb;
    const curSvPct = analytics?.savePercentage ?? null;
    const priorSvPct = prior?.savePercentage ?? null;
    const svPct = curSvPct != null && priorSvPct != null
      ? curSvPct * wConf + priorSvPct * (1 - wConf)
      : curSvPct ?? priorSvPct ?? null;
    // Save % above 65 → each extra % is worth 0.1 pts (75% → +1.0, 80% → +1.5)
    const svPctBonus = svPct != null ? Math.max(0, svPct - 65) * 0.1 : 0;
    positionScore = effectiveCsProb * csBonus(positions) * 12
      + pm(analytics?.saves, prior?.saves) * 0.4
      + svPctBonus
      + pm(analytics?.goalsPrevented, prior?.goalsPrevented) * 5
      + pm(analytics?.highClaims, prior?.highClaims) * 0.4
      - pm(analytics?.goalsConceded, prior?.goalsConceded) * 0.2;
  } else if (group === 'DEF') {
    // Defensive actions per match — weighted by how directly they prevent scoring
    const defContrib = pm(analytics?.tackles, prior?.tackles)                             * 0.8
                     + pm(analytics?.interceptions, prior?.interceptions)                 * 1.0
                     + pm(analytics?.clearances, prior?.clearances)                        * 0.4
                     + pm(analytics?.blockedShots, prior?.blockedShots)                    * 0.8
                     + pm(analytics?.possessionWonFinal3rd, prior?.possessionWonFinal3rd)  * 0.5
                     + pm(analytics?.aerialsWon, prior?.aerialsWon)                        * 0.4
                     - pm(analytics?.dribbledPast, prior?.dribbledPast)                    * 0.5
                     - pm(analytics?.foulsCommitted, prior?.foulsCommitted)                * 0.25;
    positionScore = csProb * csBonus(positions) * 10
      + gpg * goalBonus(positions) * 6
      + apg * 4
      + defContrib;
  } else if (group === 'MID') {
    const xgPerMatch = pmOr(analytics?.expectedGoals, prior?.expectedGoals, gpg);
    const kpPerMatch = pmOr(analytics?.chancesCreated, prior?.chancesCreated, apg);
    // Split by sub-role: DM values defensive work more; AM/W values creativity more; CM is balanced
    const isDM    = positions.includes('DM') && !positions.includes('AM') && !positions.includes('W');
    const isAMorW = positions.includes('AM') || positions.includes('W');
    if (isDM) {
      positionScore = xgPerMatch * goalBonus(positions) * 5
        + kpPerMatch * 3
        + pm(analytics?.shots, prior?.shots) * 0.1
        + pm(analytics?.bigChancesCreated, prior?.bigChancesCreated) * 2
        + pm(analytics?.successfulDribbles, prior?.successfulDribbles) * 0.2
        + pm(analytics?.tackles, prior?.tackles) * 0.8
        + pm(analytics?.interceptions, prior?.interceptions) * 1.2
        + pm(analytics?.clearances, prior?.clearances) * 0.3;
    } else if (isAMorW) {
      positionScore = xgPerMatch * goalBonus(positions) * 9
        + kpPerMatch * 7
        + pm(analytics?.shots, prior?.shots) * 0.2
        + pm(analytics?.bigChancesCreated, prior?.bigChancesCreated) * 5
        + pm(analytics?.successfulDribbles, prior?.successfulDribbles) * 0.5
        + pm(analytics?.tackles, prior?.tackles) * 0.15
        + pm(analytics?.interceptions, prior?.interceptions) * 0.2;
    } else {
      // CM — balanced
      positionScore = xgPerMatch * goalBonus(positions) * 7
        + kpPerMatch * 5
        + pm(analytics?.shots, prior?.shots) * 0.15
        + pm(analytics?.bigChancesCreated, prior?.bigChancesCreated) * 4
        + pm(analytics?.successfulDribbles, prior?.successfulDribbles) * 0.3
        + pm(analytics?.tackles, prior?.tackles) * 0.4
        + pm(analytics?.interceptions, prior?.interceptions) * 0.6;
    }
  } else {
    // FWD — split W (creative wide) vs ST/FW (goal threat)
    const xgPerMatch = pmOr(analytics?.expectedGoals, prior?.expectedGoals, gpg);
    const isW = positions.includes('W') && !positions.includes('ST') && !positions.includes('FW');
    if (isW) {
      positionScore = xgPerMatch * goalBonus(positions) * 8
        + pm(analytics?.chancesCreated, prior?.chancesCreated) * 3
        + apg * 6
        + pm(analytics?.shots, prior?.shots) * 0.2
        + pm(analytics?.bigChancesCreated, prior?.bigChancesCreated) * 3
        + pm(analytics?.successfulDribbles, prior?.successfulDribbles) * 0.6
        - pm(analytics?.bigChancesMissed, prior?.bigChancesMissed) * 1.5;
    } else {
      positionScore = xgPerMatch * goalBonus(positions) * 10
        + apg * 5
        + pm(analytics?.shots, prior?.shots) * 0.25
        + pm(analytics?.bigChancesCreated, prior?.bigChancesCreated) * 2
        + pm(analytics?.successfulDribbles, prior?.successfulDribbles) * 0.4
        + pm(analytics?.aerialsWon, prior?.aerialsWon) * 0.3
        - pm(analytics?.bigChancesMissed, prior?.bigChancesMissed) * 2.0;
    }
  }

  const curAvgMin = matchesPlayed > 0 && analytics?.minutesPlayed
    ? analytics.minutesPlayed / matchesPlayed : null;
  const priorAvgMin = priorMatches > 0 && prior?.minutesPlayed
    ? prior.minutesPlayed / priorMatches : null;
  const avgMin = curAvgMin != null && priorAvgMin != null
    ? curAvgMin * wConf + priorAvgMin * (1 - wConf)
    : curAvgMin ?? priorAvgMin ?? null;
  // Linear scale: 90 min avg → 12 pts, capped at 10
  const minutesScore = avgMin !== null ? Math.round(Math.min(10, (avgMin / 90) * 12)) : 0;

  // Team form momentum: (wins − losses) / matches × 4, range ≈ ±4
  const formBonus = teamForm.matches >= 3
    ? ((teamForm.wins - teamForm.losses) / teamForm.matches) * 4
    : 0;

  const noFixturePenalty = fix ? 0 : 25;

  const availPct = player.availabilityPct ?? 100;
  const baseTotal = ratingScore + fixtureScore + oddsScore + positionScore + minutesScore + formBonus - noFixturePenalty;
  const total = Math.max(0, baseTotal) * (availPct / 100);

  return {
    total,
    baseRating: rating,
    rating: ratingScore,
    fixture: fixtureScore,
    odds: oddsScore,
    position: positionScore,
    minutes: minutesScore,
    form: formBonus,
    availability: availPct,
  };
}

export function isBlocked(player: SquadPlayer): boolean {
  return player.lineupStatus === 'injured' || player.lineupStatus === 'suspended';
}
