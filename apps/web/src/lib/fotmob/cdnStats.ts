import { fotmobFetch } from './http';
import type { PlayerSeasonStats } from './types';

/**
 * Fetches a single league-wide stat list from data.fotmob.com.
 * Returns a map of playerId → value.
 *
 * FotMob stat key naming: use the exact keys from teams?.stats.players[].name
 * (e.g. "total_tackle", "effective_clearance", "clean_sheet", "expected_goals").
 *
 * StatValue vs SubStatValue semantics differ by stat:
 *   - Counting stats (tackles, interceptions, saves …) → SubStatValue = season total
 *   - Primary-display stats (goals, key passes, CS, xG …) → StatValue = season total
 *   useSubStatValue controls which to prefer (falls back to the other if null).
 */
export async function fetchLeagueStatsList(
  leagueId: number,
  seasonId: string,
  statKey: string,
  useSubStatValue = false,
): Promise<Map<number, number>> {
  try {
    const res = await fotmobFetch(`https://data.fotmob.com/stats/${leagueId}/season/${seasonId}/${statKey}.json`, 'cdn');
    if (!res.ok) return new Map();
    const data = await res.json() as {
      TopLists?: { StatList?: { ParticiantId?: number; StatValue?: number; SubStatValue?: number }[] }[]
    };
    const list = data.TopLists?.[0]?.StatList ?? [];
    const map = new Map<number, number>();
    for (const entry of list) {
      if (entry.ParticiantId != null) {
        const value = useSubStatValue
          ? (entry.SubStatValue ?? entry.StatValue)
          : (entry.StatValue ?? entry.SubStatValue);
        if (value != null) map.set(entry.ParticiantId, value);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Maps each accessible CDN stat key to a PlayerSeasonStats field.
 * Tuple: [cdnKey, field, useSubStatValue]
 *
 * StatValue vs SubStatValue per stat (determined empirically):
 *   - Defensive counting stats (tackles/interceptions/clearances/saves…) →
 *     SubStatValue = season total, StatValue = per-90 rate  → useSubStat: true
 *   - Primary display stats (goals/assists/key-passes/CS/xG…) →
 *     StatValue = season total, SubStatValue = secondary    → useSubStat: false
 *   - Percentages (_save_percentage) → StatValue = %       → useSubStat: false
 */
export const CDN_STAT_CONFIG: ReadonlyArray<readonly [string, keyof PlayerSeasonStats, boolean]> = [
  ['goals',                'goals',                 false],
  ['goal_assist',          'assists',               false],
  ['mins_played',          'minutesPlayed',         false],
  // expected_goals swaps the usual convention: StatValue is the real xG total,
  // SubStatValue is actually the goals total — verified live against 2025/26 PL data.
  ['expected_goals',       'expectedGoals',         false],
  ['ontarget_scoring_att', 'shots',                 true ],  // SubStat = total shots on target
  ['total_att_assist',     'chancesCreated',        false],  // StatValue = total key passes
  ['big_chance_created',   'bigChancesCreated',     true ],
  ['big_chance_missed',    'bigChancesMissed',      true ],
  ['total_tackle',         'tackles',               true ],
  ['interception',         'interceptions',         true ],
  ['effective_clearance',  'clearances',            true ],
  ['outfielder_block',     'blockedShots',          true ],
  ['poss_won_att_3rd',     'possessionWonFinal3rd', true ],
  ['clean_sheet',          'cleanSheets',           false],  // StatValue = total CS
  ['_save_percentage',     'savePercentage',        false],  // StatValue = %
  ['saves',                'saves',                 true ],
  ['_goals_prevented',     'goalsPrevented',        false],
  ['goals_conceded',       'goalsConceded',         true ],
  ['fouls',                'foulsCommitted',        true ],
] as const;

/**
 * Fetches all accessible CDN stat lists for a league season in parallel.
 * Returns a merged map of playerId → partial stats covering all major categories
 * (goals, assists, xG, shots, tackles, clearances, GK stats, etc.) without
 * requiring the Turnstile-blocked playerData endpoint.
 */
export async function fetchLeagueAllPlayerStats(
  leagueId: number,
  seasonId: string,
): Promise<Map<number, Partial<PlayerSeasonStats>>> {
  const results = await Promise.allSettled(
    CDN_STAT_CONFIG.map(([key, , useSubStat]) =>
      fetchLeagueStatsList(leagueId, seasonId, key, useSubStat),
    ),
  );

  const map = new Map<number, Partial<PlayerSeasonStats>>();
  CDN_STAT_CONFIG.forEach(([, field], i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    r.value.forEach((value, playerId) => {
      if (!map.has(playerId)) map.set(playerId, { playerId });
      const entry = map.get(playerId)!;
      if ((entry as Record<string, unknown>)[field] == null) {
        (entry as Record<string, unknown>)[field] = value;
      }
    });
  });
  return map;
}

/**
 * Fetches the league-wide rating ranking and returns a map of
 * playerId → { leagueRank, matchesPlayed, minutesPlayed, rating }.
 * Uses data.fotmob.com which serves gzipped static JSON (accessible server-side).
 *
 * `rating` (StatValue) is unused by the current-season aggregation in
 * squadStats.ts — that gets its `rating` field from the team endpoint instead,
 * which only ever reflects the *current* season. It exists here so a caller
 * fetching a **previous** season's id (which the team endpoint can't do) can
 * still recover that season's real rating value.
 */
export async function fetchLeagueRatingStats(
  leagueId: number,
  seasonId: string,
): Promise<Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number; rating: number | null }>> {
  const res = await fotmobFetch(`https://data.fotmob.com/stats/${leagueId}/season/${seasonId}/rating.json`, 'cdn');
  if (!res.ok) return new Map();

  const data = await res.json() as {
    TopLists: { StatName: string; StatList: {
      ParticiantId: number; Rank: number; MatchesPlayed: number; MinutesPlayed: number; StatValue: number | null;
    }[] }[]
  };

  const map = new Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number; rating: number | null }>();
  const list = data.TopLists?.find((t) => t.StatName === 'rating')?.StatList ?? [];
  for (const entry of list) {
    map.set(entry.ParticiantId, {
      leagueRank: entry.Rank,
      matchesPlayed: entry.MatchesPlayed,
      minutesPlayed: entry.MinutesPlayed,
      rating: entry.StatValue ?? null,
    });
  }
  return map;
}
