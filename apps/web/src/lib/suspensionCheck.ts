import { getLeagueFixturesCached } from '@/lib/fixturesCache';
import { getMatchCardEventsCached } from '@/lib/fotmobCache';

/**
 * Best-effort default: most European domestic leagues ban a player for one
 * match on their 5th accumulated yellow card of the season (Premier League,
 * Serie A, LaLiga all use 5 as the first threshold; exact reset behaviour
 * after that point differs by competition and isn't modelled here).
 * Deliberately NOT used to auto-set `lineupStatus` — surfaced as a warning
 * only, since getting an accumulation-based ban wrong would wrongly benched
 * an available player. A red card is the one case with no such ambiguity.
 */
export const YELLOW_CARD_BAN_THRESHOLD = 5;

/** How many days back a red/second-yellow still counts as "their last match" — roughly one round. */
const RED_CARD_RECENCY_DAYS = 12;

/** Scans a full season's worth of matches at most — caching makes repeat calls cheap. */
const MAX_MATCHES_SCANNED = 400;

export interface PlayerSuspensionInfo {
  /** Certain: red or 2nd-yellow in their most recent finished match (within ~12 days) */
  redCardLastMatch: boolean;
  /** Total yellow cards this season across all scanned finished matches */
  seasonYellowCards: number;
  lastCardedMatchDate: string | null;
}

/**
 * Builds a per-player card history for a whole league in one pass over finished
 * matches (not per-player calls) — see docs/fotmob-api.md for why this beats
 * the per-player recentMatches endpoint for this purpose.
 */
export async function getLeagueSuspensionInfo(
  leagueId: number,
): Promise<Map<number, PlayerSuspensionInfo>> {
  const { matches } = await getLeagueFixturesCached(leagueId);

  const finished = matches
    .filter((m) => m.finished)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-MAX_MATCHES_SCANNED);

  const perMatch = await Promise.all(
    finished.map((m) => getMatchCardEventsCached(m.matchId).then((cards) => ({ match: m, cards }))),
  );

  const now = Date.now();
  const info = new Map<number, PlayerSuspensionInfo>();

  for (const { match, cards } of perMatch) {
    const ageDays = (now - new Date(match.date).getTime()) / 86_400_000;
    for (const c of cards) {
      const entry = info.get(c.playerId) ?? {
        redCardLastMatch: false, seasonYellowCards: 0, lastCardedMatchDate: null,
      };
      if (c.card === 'Yellow') entry.seasonYellowCards += 1;

      const isSendingOff = c.card === 'Red' || c.card === 'YellowRed';
      entry.redCardLastMatch = isSendingOff && ageDays <= RED_CARD_RECENCY_DAYS;
      entry.lastCardedMatchDate = match.date;
      info.set(c.playerId, entry);
    }
  }

  return info;
}
