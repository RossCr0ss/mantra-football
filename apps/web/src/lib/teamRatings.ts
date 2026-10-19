import { getDb } from './mongodb';
import { fetchLeagueSeasonData, fetchMatchXg } from './fotmob';
import type { LeagueMatch, TeamFixture } from './fotmob';
import { applyMatch, emptyRatingState, predictOutcome, type RatedMatch, type TeamRatingState } from './teamStrength';

/** Mongo collection of the per-league ratings (Elo + xG form, see teamStrength.ts). */
const COLLECTION = 'team_ratings';
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
/** Minimum gap between two refresh attempts of a league — a failing FotMob must not be hammered by every request. */
const MIN_ATTEMPT_GAP_MS = 10 * 60 * 1000;
const XG_CONCURRENCY = 6;

interface RatingsDoc {
  leagueId: number;
  state: TeamRatingState;
  /** Ids of the matches already fed into `state` (a league season has ≤ 380 matches). */
  processed: string[];
  season: string;
  updatedAt: string;
}

const inFlight = new Map<number, Promise<void>>();
const lastAttempt = new Map<number, number>();

const finishedWithScore = (m: LeagueMatch) => m.finished && m.homeScore != null && m.awayScore != null;
const byDateThenId = (a: LeagueMatch, b: LeagueMatch) =>
  new Date(a.date).getTime() - new Date(b.date).getTime() || Number(a.matchId) - Number(b.matchId);

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Brings the stored ratings of a league up to date: feeds every finished match that was not processed yet, in
 * chronological order. The first run also replays last season (results only — no xG requests, goals stand in), so the
 * ratings carry over a season boundary; current-season matches get their team xG from the match-detail endpoint
 * (goals when it is missing).
 */
export async function refreshTeamRatings(leagueId: number): Promise<void> {
  const db = await getDb();
  const coll = db.collection<RatingsDoc>(COLLECTION);
  const doc = await coll.findOne({ leagueId });
  const state = doc?.state ?? emptyRatingState();
  const processed = new Set(doc?.processed ?? []);

  const current = await fetchLeagueSeasonData(leagueId);
  if (!current.season) return;
  const queue: { m: LeagueMatch; season: string; withXg: boolean }[] = [];
  if (!doc && current.previousSeason) {
    const prev = await fetchLeagueSeasonData(leagueId, current.previousSeason);
    prev.matches.filter(finishedWithScore).forEach((m) => queue.push({ m, season: current.previousSeason!, withXg: false }));
  }
  current.matches.filter(finishedWithScore).forEach((m) => queue.push({ m, season: current.season!, withXg: true }));

  const todo = queue.filter((q) => !processed.has(q.m.matchId)).sort((a, b) => byDateThenId(a.m, b.m));
  if (todo.length === 0) {
    if (doc) await coll.updateOne({ leagueId }, { $set: { updatedAt: new Date().toISOString(), season: current.season } });
    return;
  }

  const xg = await pool(todo, XG_CONCURRENCY, (q) => (q.withXg ? fetchMatchXg(q.m.matchId) : Promise.resolve({ home: null, away: null })));
  todo.forEach((q, i) => {
    const rated: RatedMatch = {
      season: q.season, homeId: q.m.homeTeam.id, awayId: q.m.awayTeam.id,
      homeScore: q.m.homeScore!, awayScore: q.m.awayScore!, homeXg: xg[i].home, awayXg: xg[i].away,
    };
    applyMatch(state, rated);
    processed.add(q.m.matchId);
  });

  await coll.updateOne(
    { leagueId },
    { $set: { leagueId, state, processed: Array.from(processed), season: current.season, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

/**
 * Stored ratings of a league (null until the first refresh finished). A missing or stale document triggers a
 * background refresh (deduplicated and rate-limited); the caller is never blocked by FotMob.
 */
export async function getTeamRatings(leagueId: number): Promise<{ state: TeamRatingState; season: string } | null> {
  const db = await getDb();
  const doc = await db.collection<RatingsDoc>(COLLECTION).findOne({ leagueId });
  const stale = !doc || Date.now() - new Date(doc.updatedAt).getTime() > REFRESH_AFTER_MS;
  const recentlyTried = Date.now() - (lastAttempt.get(leagueId) ?? 0) < MIN_ATTEMPT_GAP_MS;
  if (stale && !recentlyTried && !inFlight.has(leagueId)) {
    lastAttempt.set(leagueId, Date.now());
    const job = refreshTeamRatings(leagueId).catch(() => {}).finally(() => inFlight.delete(leagueId));
    inFlight.set(leagueId, job);
  }
  return doc ? { state: doc.state, season: doc.season } : null;
}

/** Adds the model's win / draw / loss probabilities (team's perspective) to each fixture. */
export function attachStrength(
  fixtures: Record<number, TeamFixture[]>,
  ratings: { state: TeamRatingState; season: string } | null,
): Record<number, TeamFixture[]> {
  if (!ratings) return fixtures;
  const out: Record<number, TeamFixture[]> = {};
  for (const [teamId, list] of Object.entries(fixtures)) {
    out[Number(teamId)] = list.map((f) => {
      const p = predictOutcome(ratings.state, f.homeTeam.id, f.awayTeam.id, ratings.season);
      return { ...f, strength: f.isHome ? { win: p.home, draw: p.draw, loss: p.away } : { win: p.away, draw: p.draw, loss: p.home } };
    });
  }
  return out;
}
