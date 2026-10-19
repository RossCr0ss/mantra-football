import coefJson from './teamStrengthCoef.json';

/**
 * Own match-strength model used when there are no bookmaker odds: Elo + exponentially weighted xG form of every
 * team, turned into 1X2 probabilities by a fitted multinomial logistic regression. Research and backtest:
 * `docs/scoring-research.md` §Follow-up; the python reference implementation is `scripts/weights-research/match_model.py`
 * (this file must stay identical to it — `teamStrength.test.ts` replays golden values exported by it).
 *
 * Pure and client-safe. The state is JSON-serialisable (stored in Mongo `team_ratings`, see `teamRatings.ts`).
 */

const K = 18;                 // Elo step
const HOME_ELO = 55;          // home advantage in Elo points
const SEASON_KEEP = 0.7;      // share of the distance to 1500 kept at the start of a new season
const FORM_HALF_LIFE = 8;     // matches
const ALPHA = 1 - Math.pow(0.5, 1 / FORM_HALF_LIFE);
const DEFAULT_MU = 1.35;      // league mean xG per team and match before any data
const MU_WINDOW = 400;

export interface TeamRatingState {
  /** Elo per team id. */
  elo: Record<string, number>;
  /** Exponentially weighted xG for / against per team id. */
  att: Record<string, number>;
  def: Record<string, number>;
  /** Matches that fed the xG form (capped at 6 when a new season starts, so that the form is trusted a bit less). */
  n: Record<string, number>;
  /** Season label of the last match of each team ("2025/2026"). */
  season: Record<string, string>;
  /** Running league mean xG per team and match, and the number of observations behind it. */
  mu: number;
  muN: number;
}

export interface RatedMatch {
  season: string;
  homeId: number;
  awayId: number;
  homeScore: number;
  awayScore: number;
  /** Team xG when known; the goals scored are used otherwise. */
  homeXg?: number | null;
  awayXg?: number | null;
}

export interface StrengthPrediction {
  /** Probabilities of a home win / draw / away win (sum 1). */
  home: number;
  draw: number;
  away: number;
  eloDiff: number;
  lamHome: number;
  lamAway: number;
}

export function emptyRatingState(): TeamRatingState {
  return { elo: {}, att: {}, def: {}, n: {}, season: {}, mu: DEFAULT_MU, muN: 0 };
}

/** Elo and form sample size of a team as they are at the start of `season` (season-start shrink applied virtually). */
function teamAt(s: TeamRatingState, id: number, season: string): { elo: number; n: number } {
  const k = String(id);
  const known = s.elo[k] !== undefined;
  const rolled = known && s.season[k] !== season;
  return {
    elo: known ? (rolled ? 1500 + SEASON_KEEP * (s.elo[k] - 1500) : s.elo[k]) : 1500,
    n: rolled ? Math.min(s.n[k] ?? 0, 6) : (s.n[k] ?? 0),
  };
}

/** xG attack / defence of a team, shrunk towards the league mean while the sample is short. */
function formOf(s: TeamRatingState, id: number, n: number): { xgf: number; xga: number } {
  const k = String(id);
  const w = Math.min(1, n / 6);
  return {
    xgf: s.mu + w * ((s.att[k] ?? s.mu) - s.mu),
    xga: s.mu + w * ((s.def[k] ?? s.mu) - s.mu),
  };
}

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Pre-match features of a fixture: Elo difference (home − away) and the expected goals of both sides. */
export function matchFeatures(s: TeamRatingState, homeId: number, awayId: number, season: string) {
  const h = teamAt(s, homeId, season);
  const a = teamAt(s, awayId, season);
  const fh = formOf(s, homeId, h.n);
  const fa = formOf(s, awayId, a.n);
  const lamHome = clip(((fh.xgf + fa.xga) / 2) * 1.10, 0.3, 4);
  const lamAway = clip(((fa.xgf + fh.xga) / 2) * 0.92, 0.2, 4);
  return { eloDiff: h.elo - a.elo, lamHome, lamAway };
}

/** 1X2 probabilities of a fixture before it is played. */
export function predictOutcome(s: TeamRatingState, homeId: number, awayId: number, season: string): StrengthPrediction {
  const { eloDiff, lamHome, lamAway } = matchFeatures(s, homeId, awayId, season);
  const x = [eloDiff, lamHome - lamAway, lamHome + lamAway];
  const logits = coefJson.intercept.map((b, c) => b + coefJson.coef[c].reduce((sum, w, i) => sum + w * x[i], 0));
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp(l - m));
  const z = e[0] + e[1] + e[2];
  return { home: e[0] / z, draw: e[1] / z, away: e[2] / z, eloDiff, lamHome, lamAway };
}

/**
 * Feeds one finished match into the ratings (mutates `s`). Matches must be applied in chronological order
 * (date, then match id), exactly like the research script does.
 */
export function applyMatch(s: TeamRatingState, m: RatedMatch): void {
  const kh = String(m.homeId);
  const ka = String(m.awayId);
  const h = teamAt(s, m.homeId, m.season);
  const a = teamAt(s, m.awayId, m.season);
  // commit the season roll before the update
  s.elo[kh] = h.elo; s.n[kh] = h.n; s.season[kh] = m.season;
  s.elo[ka] = a.elo; s.n[ka] = a.n; s.season[ka] = m.season;

  const gd = m.homeScore - m.awayScore;
  const expHome = 1 / (1 + Math.pow(10, -(h.elo - a.elo + HOME_ELO) / 400));
  const sHome = gd > 0 ? 1 : gd === 0 ? 0.5 : 0;
  const ad = Math.abs(gd);
  const mult = ad <= 1 ? 1 : ad === 2 ? 1.5 : (11 + ad) / 8;
  s.elo[kh] = h.elo + K * mult * (sHome - expHome);
  s.elo[ka] = a.elo - K * mult * (sHome - expHome);

  const hx = m.homeXg ?? m.homeScore;
  const ax = m.awayXg ?? m.awayScore;
  const feed = (k: string, forXg: number, againstXg: number) => {
    if (s.att[k] !== undefined) {
      s.att[k] += ALPHA * (forXg - s.att[k]);
      s.def[k] += ALPHA * (againstXg - s.def[k]);
    } else {
      s.att[k] = forXg;
      s.def[k] = againstXg;
    }
    s.n[k] = (s.n[k] ?? 0) + 1;
  };
  feed(kh, hx, ax);
  feed(ka, ax, hx);

  const step = Math.min(s.muN + 1, MU_WINDOW);
  s.mu += (hx - s.mu) / step;
  s.mu += (ax - s.mu) / step;
  s.muN += 2;
}
