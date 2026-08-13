/**
 * MongoDB SWR-cached wrapper for mantrafootball.org calls.
 * Use this in API routes — never call mantraFootball.ts raw functions directly from routes.
 *
 * Collection layout:
 *   mantra_positions   { tournamentId, data: MantraPlayer[], cachedAt }
 *
 * The authenticated session/team-roster fetch (mantraFootball.ts, once added) is
 * intentionally NOT cached here — it carries a login-derived credential and stays
 * in-memory only, never persisted to Mongo.
 */

import { fetchMantraTournamentPlayers, type MantraPlayer } from './mantraFootball';
import { withCache, CACHE_TTL } from './mongoCache';

type Opts = { forceRefresh?: boolean };

export function getMantraTournamentPlayersCached(
  tournamentId: number,
  opts?: Opts,
): Promise<MantraPlayer[]> {
  return withCache(
    'mantra_positions',
    { tournamentId },
    CACHE_TTL.MANTRA_POSITIONS,
    () => fetchMantraTournamentPlayers(tournamentId),
    opts,
  );
}
