const FOTMOB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.fotmob.com/',
  'Origin': 'https://www.fotmob.com',
  'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

/**
 * Returns FOTMOB_HEADERS augmented with the FOTMOB_COOKIE env var when set.
 * The cookie contains a browser session that has passed Cloudflare Turnstile,
 * which is required for the playerData endpoint. Extract it from DevTools on
 * any successful playerData request on www.fotmob.com.
 */
function playerDataHeaders(): Record<string, string> {
  const cookie = process.env.FOTMOB_COOKIE;
  if (!cookie) return FOTMOB_HEADERS;
  return { ...FOTMOB_HEADERS, Cookie: cookie };
}

export interface PlayerSeasonStats {
  playerId: number;
  /** Season average rating, null if < 3 matches played */
  rating: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  /** League-wide rank by rating */
  leagueRank: number | null;
  matchesPlayed: number | null;
  minutesPlayed: number | null;
  // ── GK stats ──
  cleanSheets: number | null;
  saves: number | null;
  goalsConceded: number | null;
  savePercentage: number | null;
  goalsPrevented: number | null;
  penaltySaves: number | null;
  actedSweeper: number | null;
  highClaims: number | null;
  errorLeadToGoal: number | null;
  // ── DEF stats ──
  tackles: number | null;
  interceptions: number | null;
  clearances: number | null;
  blockedShots: number | null;
  aerialsWon: number | null;
  foulsCommitted: number | null;
  possessionWonFinal3rd: number | null;
  dribbledPast: number | null;
  // ── MID/FWD stats ──
  expectedGoals: number | null;
  shots: number | null;
  chancesCreated: number | null;
  successfulDribbles: number | null;
  bigChancesCreated: number | null;
  bigChancesMissed: number | null;
}

/**
 * Returns a map of playerId → stats for all players currently in the team squad.
 * Only the team endpoint is used here (playerData is Cloudflare-blocked server-side).
 * Detailed positional stats are overlaid by the analytics route from CDN stat lists.
 */
export async function fetchTeamPlayerStats(
  teamId: number,
  teamName: string,
): Promise<Map<number, PlayerSeasonStats>> {
  const players = await fetchTeamPlayers(teamId, teamName);
  const map = new Map<number, PlayerSeasonStats>();
  for (const p of players) {
    map.set(p.id, {
      playerId:              p.id,
      rating:                p.seasonRating,
      goals:                 p.goals,
      assists:               p.assists,
      yellowCards:           p.yellowCards,
      redCards:              p.redCards,
      leagueRank:            null,
      matchesPlayed:         null,
      minutesPlayed:         null,
      cleanSheets:           null,
      saves:                 null,
      goalsConceded:         null,
      savePercentage:        null,
      goalsPrevented:        null,
      penaltySaves:          null,
      actedSweeper:          null,
      highClaims:            null,
      errorLeadToGoal:       null,
      tackles:               null,
      interceptions:         null,
      clearances:            null,
      blockedShots:          null,
      aerialsWon:            null,
      foulsCommitted:        null,
      possessionWonFinal3rd: null,
      dribbledPast:          null,
      expectedGoals:         null,
      shots:                 null,
      chancesCreated:        null,
      successfulDribbles:    null,
      bigChancesCreated:     null,
      bigChancesMissed:      null,
    });
  }
  return map;
}

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
    const res = await fetch(
      `https://data.fotmob.com/stats/${leagueId}/season/${seasonId}/${statKey}.json`,
      { headers: { ...FOTMOB_HEADERS, 'Accept-Encoding': 'gzip' }, cache: 'no-store' },
    );
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
const CDN_STAT_CONFIG: ReadonlyArray<readonly [string, keyof PlayerSeasonStats, boolean]> = [
  ['goals',                'goals',                 false],
  ['goal_assist',          'assists',               false],
  ['mins_played',          'minutesPlayed',         false],
  ['expected_goals',       'expectedGoals',         true ],  // SubStat = total xG
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
 * playerId → { leagueRank, matchesPlayed, minutesPlayed }.
 * Uses data.fotmob.com which serves gzipped static JSON (accessible server-side).
 */
export async function fetchLeagueRatingStats(
  leagueId: number,
  seasonId: string,
): Promise<Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number }>> {
  const res = await fetch(
    `https://data.fotmob.com/stats/${leagueId}/season/${seasonId}/rating.json`,
    {
      headers: { ...FOTMOB_HEADERS, 'Accept-Encoding': 'gzip' },
      cache: 'no-store',
    },
  );
  if (!res.ok) return new Map();

  const data = await res.json() as {
    TopLists: { StatName: string; StatList: {
      ParticiantId: number; Rank: number; MatchesPlayed: number; MinutesPlayed: number;
    }[] }[]
  };

  const map = new Map<number, { leagueRank: number; matchesPlayed: number; minutesPlayed: number }>();
  const list = data.TopLists?.find((t) => t.StatName === 'rating')?.StatList ?? [];
  for (const entry of list) {
    map.set(entry.ParticiantId, {
      leagueRank: entry.Rank,
      matchesPlayed: entry.MatchesPlayed,
      minutesPlayed: entry.MinutesPlayed,
    });
  }
  return map;
}

/**
 * Returns the primarySeasonId for a league by fetching any team from it.
 * Result cached via Next.js fetch cache.
 */
export async function fetchLeagueSeasonId(leagueId: number): Promise<string | null> {
  // Use the league table to find a team, then get season from that team's stats
  try {
    const teams = await fetchLeagueTeams(leagueId);
    if (!teams.length) return null;
    const res = await fetch(
      `https://www.fotmob.com/api/data/teams?id=${teams[0].id}`,
      { headers: FOTMOB_HEADERS, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const seasonId: string | null = data?.stats?.primarySeasonId ?? null;
    return seasonId ? String(seasonId) : null;
  } catch {
    return null;
  }
}

export interface FotMobLeague {
  id: number;
  name: string;
  country: string;
  countryCode: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
}

export const LEAGUES: FotMobLeague[] = [
  {
    id: 47,
    name: 'Premier League',
    country: 'England',
    countryCode: 'GB-ENG',
    primaryColor: '#3d195b',
    secondaryColor: '#00ff85',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/47.png',
  },
  {
    id: 55,
    name: 'Serie A',
    country: 'Italy',
    countryCode: 'IT',
    primaryColor: '#024494',
    secondaryColor: '#000000',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/55.png',
  },
  {
    id: 40,
    name: 'First Division A',
    country: 'Belgium',
    countryCode: 'BE',
    primaryColor: '#1a1a2e',
    secondaryColor: '#e94560',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/40.png',
  },
  {
    id: 441,
    name: 'Ukrainian Premier League',
    country: 'Ukraine',
    countryCode: 'UA',
    primaryColor: '#005bbb',
    secondaryColor: '#ffd500',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/441.png',
  },
  {
    id: 87,
    name: 'LaLiga',
    country: 'Spain',
    countryCode: 'ES',
    primaryColor: '#ee8707',
    secondaryColor: '#a50044',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/87.png',
  },
];

export interface FotMobTeam {
  id: number;
  name: string;
  shortName: string;
  logoUrl: string;
}

export interface PlayerInjuryInfo {
  name: string;
  /** Display string — may be "Doubtful", a formatted date, etc. */
  expectedReturn: string | null;
  /** ISO date string (YYYY-MM-DD) for precise date comparisons, null when unknown */
  expectedReturnDate: string | null;
  lastUpdated: string | null;
  /** True when the record has been manually overridden in the database */
  overridden?: boolean;
  /** True when the player was manually marked as healed; FotMob data is suppressed */
  cleared?: boolean;
}

export interface FotMobPlayer {
  id: number;
  name: string;
  shirtNumber: number | null;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  positionLabel: string;
  nationality: string;
  age: number | null;
  injured: boolean;
  imageUrl: string;
  teamName: string;
  teamId: number;
  // Season stats (from api/data/teams squad members)
  seasonRating: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

export async function fetchPlayerInjuryInfo(playerId: number): Promise<PlayerInjuryInfo | null> {
  let res: Response;
  try {
    res = await fetch(
      `https://www.fotmob.com/api/data/playerData?id=${playerId}`,
      { headers: playerDataHeaders(), cache: 'no-store' },
    );
  } catch (error) {
    return null;
  }
  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const injury = data?.injuryInformation;
  if (!injury) {
    return null;
  }

  return {
    name: injury.name ?? 'Unknown injury',
    expectedReturn: injury.expectedReturn?.expectedReturnFallback ?? null,
    expectedReturnDate: injury.expectedReturn?.expectedReturnDateParam ?? null,
    lastUpdated: injury.lastUpdated?.utcTime ?? null,
  };
}

// ── Per-player season stats (from playerData endpoint) ────────────────────────

/**
 * Maps known FotMob stat keys (from stat.seasonStatList[].items[].key) to our
 * PlayerSeasonStats fields. FotMob uses both camelCase and underscore variants
 * across API versions — both are listed here.
 */
const STAT_KEY_MAP: Partial<Record<string, keyof PlayerSeasonStats>> = {
  games_played: 'matchesPlayed', matches_played: 'matchesPlayed', matches: 'matchesPlayed',
  minutes_played: 'minutesPlayed', minutes: 'minutesPlayed',
  goals: 'goals', assists: 'assists',
  yellow_cards: 'yellowCards', yellowcards: 'yellowCards',
  red_cards: 'redCards', redcards: 'redCards',
  // GK
  clean_sheet: 'cleanSheets', cleansheets: 'cleanSheets', cleansheet: 'cleanSheets',
  saves: 'saves',
  goals_conceded: 'goalsConceded', goalsconceded: 'goalsConceded',
  save_percentage: 'savePercentage', savepercentage: 'savePercentage',
  goals_prevented: 'goalsPrevented', goalsprevented: 'goalsPrevented',
  penalty_saves: 'penaltySaves', penaltysaves: 'penaltySaves',
  acted_sweeper: 'actedSweeper', actedsweeper: 'actedSweeper', sweeper: 'actedSweeper',
  high_claims: 'highClaims', highclaims: 'highClaims', highclaim: 'highClaims',
  error_lead_to_goal: 'errorLeadToGoal', errorleadtogoal: 'errorLeadToGoal',
  // DEF
  tackles_won: 'tackles', tackles: 'tackles',
  interceptions: 'interceptions',
  clearances: 'clearances',
  blocked_shots: 'blockedShots', blockedshots: 'blockedShots',
  aerials_won: 'aerialsWon', aerialswon: 'aerialsWon', aerial_duels_won: 'aerialsWon',
  fouls_committed: 'foulsCommitted', foulscommitted: 'foulsCommitted',
  possession_won_final3rd: 'possessionWonFinal3rd', possessionwonfinal3rd: 'possessionWonFinal3rd',
  ball_won_final3rd: 'possessionWonFinal3rd', ballwonfinal3rd: 'possessionWonFinal3rd',
  dribbled_past: 'dribbledPast', dribbledpast: 'dribbledPast',
  // MID/FWD
  expected_goals: 'expectedGoals', expectedgoals: 'expectedGoals', xg: 'expectedGoals',
  shots: 'shots', shots_on_target: 'shots', shotsontarget: 'shots',
  key_passes: 'chancesCreated', keypasses: 'chancesCreated',
  chances_created: 'chancesCreated', chancescreated: 'chancesCreated',
  successful_dribbles: 'successfulDribbles', successfuldribbles: 'successfulDribbles',
  dribbles: 'successfulDribbles',
  big_chances_created: 'bigChancesCreated', bigchancescreated: 'bigChancesCreated',
  big_chances_missed: 'bigChancesMissed', bigchancesmissed: 'bigChancesMissed',
};

/** Same as STAT_KEY_MAP but matched against the human-readable title string. */
const STAT_TITLE_MAP: Partial<Record<string, keyof PlayerSeasonStats>> = {
  'Matches played': 'matchesPlayed', 'Matches': 'matchesPlayed', 'Minutes played': 'minutesPlayed',
  'Goals': 'goals', 'Assists': 'assists',
  'Yellow cards': 'yellowCards', 'Red cards': 'redCards',
  // GK
  'Clean sheets': 'cleanSheets', 'Saves': 'saves', 'Goals conceded': 'goalsConceded',
  'Save percentage': 'savePercentage', 'Goals prevented': 'goalsPrevented',
  'Penalty saves': 'penaltySaves', 'Sweeper clearances': 'actedSweeper',
  'Sweeper actions': 'actedSweeper', 'High claims': 'highClaims',
  'Error led to goal': 'errorLeadToGoal', 'Errors leading to goal': 'errorLeadToGoal',
  // DEF
  'Tackles won': 'tackles', 'Tackles': 'tackles', 'Interceptions': 'interceptions',
  'Clearances': 'clearances', 'Blocked shots': 'blockedShots',
  'Aerials won': 'aerialsWon', 'Aerial duels won': 'aerialsWon',
  'Fouls committed': 'foulsCommitted',
  'Possession won in final third': 'possessionWonFinal3rd',
  'Ball won in final third': 'possessionWonFinal3rd',
  'Dribbled past': 'dribbledPast',
  // MID/FWD
  'Expected goals (xG)': 'expectedGoals', 'xG': 'expectedGoals', 'Expected goals': 'expectedGoals',
  'Shots': 'shots', 'Shots on target': 'shots',
  'Key passes': 'chancesCreated', 'Chances created': 'chancesCreated',
  'Successful dribbles': 'successfulDribbles', 'Dribbles': 'successfulDribbles',
  'Big chances created': 'bigChancesCreated', 'Big chances missed': 'bigChancesMissed',
};

function parseStatNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return parseStatNum(obj.numberValue ?? obj.value ?? obj.statValue ?? obj.num ?? null);
  }
  return null;
}

/**
 * Walks a raw stat item and returns a [field, value] pair if recognisable,
 * or null otherwise. Tries .key / .localizedTitleId then .title for field identification.
 */
function parseStatItem(
  item: Record<string, unknown>,
): [keyof PlayerSeasonStats, number] | null {
  const rawVal = item.statValueDecimal ?? item.statValue ?? item.value ?? item.stat;
  const num = parseStatNum(rawVal);
  if (num == null) return null;

  // Try explicit key fields first (camelCase or snake_case identifiers)
  const keyRaw = item.key ?? item.localizedTitleId;
  const key = typeof keyRaw === 'string' ? keyRaw.toLowerCase() : null;
  if (key) {
    const field = STAT_KEY_MAP[key];
    if (field) return [field, num];
  }
  const title = typeof item.title === 'string' ? item.title : null;
  if (title) {
    const field = STAT_TITLE_MAP[title];
    if (field) return [field, num];
  }
  return null;
}

/**
 * Collects stat items from all known shapes FotMob has used for playerData.
 * Tries `stat.seasonStatList` first (current structure), then several fallbacks.
 */
function collectStatItems(data: Record<string, unknown>): Record<string, unknown>[] {
  // Shape A: data.stat.seasonStatList[].items[]  (most common current shape)
  // Also handles sections nested within a season entry (items inside sections[].items[])
  const statBlock = data.stat as Record<string, unknown> | null;
  if (statBlock) {
    const seasonList = statBlock.seasonStatList as Record<string, unknown>[] | null;
    if (Array.isArray(seasonList) && seasonList.length > 0) {
      // Prefer isCurrent season; fall back to last entry (newest) rather than first (oldest)
      const current = seasonList.find(
        (s) => s.isCurrent === true || s.isCurrent === 1,
      ) ?? seasonList[seasonList.length - 1];

      // Flat items directly on the season entry
      const items = current?.items as Record<string, unknown>[] | null;
      if (Array.isArray(items) && items.length > 0) return items;

      // Items nested within sections (FotMob groups stats by category)
      const sections = current?.sections as Record<string, unknown>[] | null;
      if (Array.isArray(sections) && sections.length > 0) {
        const nested = sections.flatMap(
          (s) => (s.items as Record<string, unknown>[] | null) ?? [],
        );
        if (nested.length > 0) return nested;
      }
    }
  }

  // Shape B: data.statsSection.sections[].items[]
  const statsSection = data.statsSection as Record<string, unknown> | null;
  if (statsSection) {
    const sections = statsSection.sections as Record<string, unknown>[] | null;
    if (Array.isArray(sections)) {
      const items = sections.flatMap(
        (s) => (s.items as Record<string, unknown>[] | null) ?? [],
      );
      if (items.length > 0) return items;
    }
  }

  // Shape C: data.statSummary.items[]  or  data.statSummary.commonSummary.statTypes[]
  const statSummary = data.statSummary as Record<string, unknown> | null;
  if (statSummary) {
    const direct = statSummary.items as Record<string, unknown>[] | null;
    if (Array.isArray(direct) && direct.length > 0) return direct;
    const commonItems = (
      statSummary.commonSummary as Record<string, unknown> | null
    )?.statTypes as Record<string, unknown>[] | null;
    if (Array.isArray(commonItems) && commonItems.length > 0) return commonItems;
  }

  // Shape D: data.mainLeague.stats — summary stats (goals, assists, rating, etc.)
  // Used as a last-resort fallback; only covers ~8 basic fields but beats returning nothing.
  const mainLeague = data.mainLeague as Record<string, unknown> | null;
  if (mainLeague) {
    const stats = mainLeague.stats as Record<string, unknown>[] | null;
    if (Array.isArray(stats) && stats.length > 0) return stats;
  }

  return [];
}

/**
 * Fetches the FotMob playerData endpoint and extracts season stats for the
 * current (or most recent) league season. Returns a partial PlayerSeasonStats
 * — only fields found in the response are populated; everything else is null.
 *
 * This is the primary source for per-player positional stats (tackles, xG, etc.)
 * because the CDN stat-list endpoints only cover top-N players and many keys
 * are inaccessible. The playerData endpoint returns complete stats per player.
 */
export async function fetchPlayerSeasonStats(
  playerId: number,
): Promise<Partial<PlayerSeasonStats>> {
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/data/playerData?id=${playerId}`,
      { headers: playerDataHeaders(), cache: 'no-store' },
    );
    if (!res.ok) return {};
    const data = await res.json() as Record<string, unknown>;
    const items = collectStatItems(data);
    if (!items.length) return {};

    const partial: Partial<PlayerSeasonStats> = {};
    for (const item of items) {
      const parsed = parseStatItem(item);
      if (parsed) {
        const [field, value] = parsed;
        if ((partial as Record<string, unknown>)[field] == null) {
          (partial as Record<string, unknown>)[field] = value;
        }
      }
    }
    return partial;
  } catch {
    return {};
  }
}

// ── Rich per-player stats from firstSeasonStats.statsSection ─────────────────

export interface PlayerStatItem {
  title: string;
  localizedTitleId: string;
  statValue: string;
  per90: number;
  /** 0–100: what % of positional peers rank lower for this stat */
  percentileRank: number;
  statFormat: 'number' | 'fraction' | 'percent';
}

export interface PlayerStatGroup {
  title: string;
  localizedTitleId: string;
  items: PlayerStatItem[];
}

export interface PlayerRichStats {
  groups: PlayerStatGroup[];
}

/**
 * Fetches `firstSeasonStats.statsSection` from the FotMob playerData endpoint.
 * Returns structured stat groups with percentile rank data (vs positional peers).
 */
export async function fetchPlayerRichStats(playerId: number): Promise<PlayerRichStats | null> {
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/data/playerData?id=${playerId}`,
      { headers: playerDataHeaders(), cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    const firstSeasonStats = data?.firstSeasonStats as Record<string, unknown> | null;
    const statsSection = firstSeasonStats?.statsSection as Record<string, unknown> | null;
    if (!statsSection) return null;

    const rawGroups = (statsSection.items ?? []) as Record<string, unknown>[];
    const groups: PlayerStatGroup[] = [];

    for (const rawGroup of rawGroups) {
      if (rawGroup.display !== 'stats-group') continue;
      const rawItems = (rawGroup.items ?? []) as Record<string, unknown>[];
      const items: PlayerStatItem[] = rawItems.map((gi) => ({
        title: String(gi.title ?? ''),
        localizedTitleId: String(gi.localizedTitleId ?? ''),
        statValue: String(gi.statValue ?? ''),
        per90: Number(gi.per90 ?? 0),
        percentileRank: Number(gi.percentileRank ?? 0),
        statFormat: (gi.statFormat as PlayerStatItem['statFormat']) ?? 'number',
      }));
      if (items.length > 0) {
        groups.push({
          title: String(rawGroup.title ?? ''),
          localizedTitleId: String(rawGroup.localizedTitleId ?? ''),
          items,
        });
      }
    }

    return groups.length > 0 ? { groups } : null;
  } catch {
    return null;
  }
}

// ── Player recent match form ───────────────────────────────────────────────────

export interface PlayerRecentMatch {
  matchId: string;
  date: string;
  opponentName: string;
  opponentId: number;
  isHome: boolean;
  result: 'W' | 'D' | 'L' | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  minutesPlayed: number | null;
  rating: number | null;
  goals: number;
  assists: number;
  yellowCard: boolean;
  redCard: boolean;
  leagueId: number;
  /** true if in the starting XI (playedInMatch && !onBench) — false for subs, unused subs, and DNPs. */
  started: boolean;
}

/**
 * Last 5 appearances in the given league only — recentMatches mixes in cup and
 * international fixtures, so leagueId filters those out before taking the last 5.
 */
export async function fetchPlayerRecentMatches(
  playerId: number,
  leagueId: number,
): Promise<PlayerRecentMatch[]> {
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/data/playerData?id=${playerId}`,
      { headers: playerDataHeaders(), cache: 'no-store' },
    );
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const raw = data?.recentMatches as Record<string, unknown>[] | null;
    if (!Array.isArray(raw)) return [];

    return raw
      .filter((m) => Number(m.leagueId ?? 0) === leagueId)
      .slice(-5)
      .map((m): PlayerRecentMatch | null => {
        try {
          // Current FotMob shape: isHomeTeam, opponentTeamId/Name, matchDate.utcTime, ratingProps.rating
          // Legacy FotMob shape: home/away objects, date/status.utcTime, playerRating
          const home = (m.home as Record<string, unknown> | null) ?? {};
          const away = (m.away as Record<string, unknown> | null) ?? {};

          // isHome: prefer explicit flag, fall back to home.id === teamId
          const teamId = Number(m.teamId ?? 0);
          const homeId = Number(home.id ?? 0);
          const isHome = m.isHomeTeam != null
            ? Boolean(m.isHomeTeam)
            : (homeId > 0 && homeId === teamId);

          // Score: top-level homeScore/awayScore (both shapes)
          const hs = m.homeScore != null ? Number(m.homeScore)
            : home.score != null ? Number(home.score) : null;
          const as_ = m.awayScore != null ? Number(m.awayScore)
            : away.score != null ? Number(away.score) : null;

          const goalsFor     = isHome ? hs  : as_;
          const goalsAgainst = isHome ? as_ : hs;
          let result: 'W' | 'D' | 'L' | null = null;
          if (goalsFor != null && goalsAgainst != null) {
            result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
          }

          // Rating: ratingProps.rating (string) | playerRating | rating (plain/object)
          const ratingRaw = (m.ratingProps as Record<string, unknown> | null)?.rating
            ?? m.playerRating ?? m.rating;
          const ratingNum = ratingRaw == null ? null
            : typeof ratingRaw === 'object'
              ? Number((ratingRaw as Record<string, unknown>).num ?? null)
              : Number(ratingRaw);
          const rating = ratingNum != null && !isNaN(ratingNum) && ratingNum > 0 ? ratingNum : null;

          // Date: matchDate.utcTime | date | status.utcTime
          const matchDate = m.matchDate as Record<string, unknown> | null;
          const date = String(
            matchDate?.utcTime ?? m.date ?? (m.status as Record<string, unknown> | null)?.utcTime ?? '',
          );

          // Opponent: prefer opponentTeamId/Name; fall back to home/away objects
          const opponentId = m.opponentTeamId != null
            ? Number(m.opponentTeamId)
            : isHome ? Number(away.id ?? 0) : Number(home.id ?? 0);
          const opponentName = m.opponentTeamName != null
            ? String(m.opponentTeamName)
            : isHome ? String(away.name ?? '') : String(home.name ?? '');

          // Cards: yellowCards/redCards (numbers) or yellowCard/redCard (booleans)
          const yellowCard = m.yellowCards != null ? Number(m.yellowCards) > 0 : Boolean(m.yellowCard);
          const redCard    = m.redCards    != null ? Number(m.redCards)    > 0 : Boolean(m.redCard);
          const started = Boolean(m.playedInMatch) && !Boolean(m.onBench);

          return {
            matchId: String(m.id ?? ''),
            date,
            opponentName,
            opponentId,
            isHome,
            result,
            goalsFor,
            goalsAgainst,
            minutesPlayed: m.minutesPlayed != null ? Number(m.minutesPlayed) : null,
            rating,
            goals: Number(m.goals ?? 0),
            assists: Number(m.assists ?? 0),
            yellowCard,
            redCard,
            leagueId: Number(m.leagueId ?? 0),
            started,
          };
        } catch {
          return null;
        }
      })
      .filter((m): m is PlayerRecentMatch => m !== null);
  } catch {
    return [];
  }
}

// ============ Fixtures ============

export interface FixtureTeam {
  id: number;
  name: string;
  logoUrl: string;
}

export interface FixtureOdds {
  home: number | null;
  draw: number | null;
  away: number | null;
}

/** Raw match entry as returned by the league endpoint (data.matches.allMatches). */
export interface LeagueMatch {
  matchId: string;
  date: string; // ISO UTC
  round: string | null;
  homeTeam: FixtureTeam;
  awayTeam: FixtureTeam;
  finished: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

/** LeagueMatch enriched with team-relative fields (isHome, opponent, difficulty). */
export interface TeamFixture extends LeagueMatch {
  isHome: boolean;
  opponent: FixtureTeam;
  /**
   * 1 = easy (bottom-table opponent) … 5 = very hard (top-table opponent).
   * Derived from opponent's position in the league table.
   */
  difficulty: number | null;
  odds: FixtureOdds | null;
}

/**
 * Extracts team rows from a FotMob league table data block.
 *
 * FotMob uses two different shapes depending on the league:
 *   - Standard (e.g. PL, Serie A): data.table.all
 *   - Playoff/group (e.g. Belgian Pro League): data.tables[].table.all
 *
 * Returns a deduplicated, ordered list of rows with at least { id, name, shortName }.
 */
function extractTableRows(
  data: Record<string, unknown> | undefined | null,
): { id: number; name: string; shortName: string }[] {
  if (!data) return [];

  // Standard shape
  const single = data.table as { all?: { id: number; name: string; shortName: string }[] } | null;
  if (Array.isArray(single?.all) && single!.all!.length > 0) {
    return single!.all!;
  }

  // Playoff/group shape (e.g. Belgium) — aggregate unique teams from all sub-tables
  const subTables = data.tables as { table?: { all?: { id: number; name: string; shortName: string }[] } }[] | null;
  if (!Array.isArray(subTables)) return [];

  const seen = new Set<number>();
  const rows: { id: number; name: string; shortName: string }[] = [];
  for (const sub of subTables) {
    for (const row of sub.table?.all ?? []) {
      const id = Number(row.id);
      if (!seen.has(id)) {
        seen.add(id);
        rows.push(row);
      }
    }
  }
  return rows;
}

/**
 * Fetches league table positions AND all matches in a single call to the
 * leagues endpoint. This replaces the former per-team fixture fetching:
 * one request covers every squad team instead of one request per team.
 *
 * data.matches.allMatches — full season schedule (past + upcoming)
 * data.matches.firstUnplayedMatch — pointer to the current active round
 * data.table[0].data.table.all — current standings (or data.table[0].data.tables for playoff leagues)
 */
export async function fetchLeagueData(leagueId: number): Promise<{
  tablePositions: Map<number, number>;
  matches: LeagueMatch[];
  currentRound: string | null;
}> {
  const res = await fetch(
    `https://www.fotmob.com/api/data/leagues?id=${leagueId}`,
    { headers: FOTMOB_HEADERS, cache: 'no-store' },
  );
  if (!res.ok) return { tablePositions: new Map(), matches: [], currentRound: null };
  const data = await res.json() as Record<string, unknown>;

  // Table positions — FotMob returns team IDs as numbers in the table
  const tableGroups: { data: { table: { all: { id: number }[] } } }[] =
    (data?.table as typeof tableGroups) ?? [];
  const rows = extractTableRows(tableGroups[0]?.data);
  const tablePositions = new Map<number, number>();
  rows.forEach((row, i) => tablePositions.set(Number(row.id), i + 1));

  // Matches — live at data.fixtures.allMatches (NOT data.matches)
  // NOTE: FotMob returns home.id / away.id as strings — always parse with Number()
  const matchesBlock = data?.fixtures as Record<string, unknown> | null;
  const raw = (matchesBlock?.allMatches as Record<string, unknown>[]) ?? [];

  const matches: LeagueMatch[] = raw
    .map((m): LeagueMatch | null => {
      const home = m.home as { id: string | number; name: string; score?: number | string | null } | null;
      const away = m.away as { id: string | number; name: string; score?: number | string | null } | null;
      const status = m.status as {
        utcTime?: string; finished?: boolean; started?: boolean; cancelled?: boolean;
        scoreStr?: string;
      } | null;
      if (!home?.id || !away?.id) return null;
      const homeId = Number(home.id);
      const awayId = Number(away.id);
      if (!homeId || !awayId) return null;
      const roundRaw = m.round ?? m.roundName;

      // FotMob stopped embedding score in home/away objects; it now lives in
      // status.scoreStr as "H - A" (e.g. "2 - 1"). Fall back to home.score if present.
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      if (status?.scoreStr) {
        const parts = status.scoreStr.split('-');
        if (parts.length === 2) {
          const h = parseInt(parts[0].trim(), 10);
          const a = parseInt(parts[1].trim(), 10);
          if (!isNaN(h)) homeScore = h;
          if (!isNaN(a)) awayScore = a;
        }
      } else if (home.score != null) {
        homeScore = Number(home.score);
        awayScore = away?.score != null ? Number(away.score) : null;
      }

      return {
        matchId: String(m.id ?? ''),
        date: status?.utcTime ?? '',
        round: roundRaw != null ? String(roundRaw) : null,
        homeTeam: {
          id: homeId,
          name: home.name,
          logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${homeId}.png`,
        },
        awayTeam: {
          id: awayId,
          name: away.name,
          logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${awayId}.png`,
        },
        finished: status?.finished ?? false,
        homeScore,
        awayScore,
      };
    })
    .filter((m): m is LeagueMatch => m !== null);

  // Determine the current active round from firstUnplayedMatch.
  // Use matchId lookup (not index — firstUnplayedMatchIndex is 1-based in the API).
  const firstUnplayed = matchesBlock?.firstUnplayedMatch as
    { firstUnplayedMatchId?: string } | null;
  const firstUnplayedId = firstUnplayed?.firstUnplayedMatchId
    ? String(firstUnplayed.firstUnplayedMatchId)
    : null;
  const currentRound = firstUnplayedId
    ? (matches.find((m) => m.matchId === firstUnplayedId)?.round ?? null)
    : null;

  return { tablePositions, matches, currentRound };
}

/**
 * Fetch 1×2 betting odds for a specific match from FotMob.
 * Requires FOTMOB_CCODE3 and FOTMOB_BETTING_PROVIDER env vars (defaults: UKR / 22Bet_Ukraine).
 * Called server-side from the /api/matches/[id]/odds route.
 */
export async function fetchMatchOdds(matchId: string): Promise<FixtureOdds | null> {
  if (!matchId) return null;
  const ccode3 = process.env.FOTMOB_CCODE3 ?? 'UKR';
  const provider = process.env.FOTMOB_BETTING_PROVIDER ?? '22Bet_Ukraine';
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/data/matchOdds?matchId=${matchId}&ccode3=${ccode3}&bettingProvider=${provider}`,
      { headers: FOTMOB_HEADERS, cache: 'no-store' },
    );
    if (!res.ok || res.status === 204) return null;
    const data = await res.json() as Record<string, unknown>;
    return parseMatchOdds(data);
  } catch {
    return null;
  }
}

/**
 * Client-side version of fetchMatchOdds — same endpoint, uses NEXT_PUBLIC_ env vars.
 * Falls back to the same defaults as the server-side version.
 */
export async function fetchMatchOddsClient(matchId: string): Promise<FixtureOdds | null> {
  if (!matchId) return null;
  const ccode3 = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FOTMOB_CCODE3) ?? 'UKR';
  const provider = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FOTMOB_BETTING_PROVIDER) ?? '22Bet_Ukraine';
  try {
    const res = await fetch(
      `/api/matches/${matchId}/odds?ccode3=${ccode3}&bettingProvider=${provider}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as { odds: FixtureOdds | null };
    return data.odds ?? null;
  } catch {
    return null;
  }
}

function parseMatchOdds(data: Record<string, unknown>): FixtureOdds | null {
  // Structure: { odds: { matchfactMarkets: [{ selections: [{name:"1"|"x"|"2", oddsDecimal:"1.85"}] }] } }
  const odds = data?.odds as Record<string, unknown> | null;
  const markets = odds?.matchfactMarkets as { selections?: { name?: string; oddsDecimal?: string }[] }[] | null;
  const selections = Array.isArray(markets) ? (markets[0]?.selections ?? []) : [];

  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;

  for (const s of selections) {
    const n = s.name?.toLowerCase() ?? '';
    const v = s.oddsDecimal ? parseFloat(s.oddsDecimal) : NaN;
    if (isNaN(v)) continue;
    if (n === '1') home = v;
    else if (n === 'x') draw = v;
    else if (n === '2') away = v;
  }

  if (home === null && draw === null && away === null) return null;
  return { home, draw, away };
}

// ============ Squad ============

const SQUAD_GROUP_TO_POSITION: Record<string, FotMobPlayer['position']> = {
  keepers: 'GK',
  defenders: 'DEF',
  midfielders: 'MID',
  attackers: 'FWD',
};

export async function fetchLeagueTeams(leagueId: number): Promise<FotMobTeam[]> {
  let res: Response;
  try {
    res = await fetch(
      `https://www.fotmob.com/api/data/leagues?id=${leagueId}`,
      { headers: FOTMOB_HEADERS, cache: 'no-store' },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();

  const tableGroups = (data?.table as { data: Record<string, unknown> }[]) ?? [];
  const rows = extractTableRows(tableGroups[0]?.data);

  return rows.map((t) => ({
    id: Number(t.id),
    name: t.name,
    shortName: t.shortName,
    logoUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${Number(t.id)}.png`,
  }));
}

export async function fetchTeamPlayers(teamId: number, teamName: string): Promise<FotMobPlayer[]> {
  const res = await fetch(
    `https://www.fotmob.com/api/data/teams?id=${teamId}`,
    { headers: FOTMOB_HEADERS, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`FotMob teams error: ${res.status}`);
  const data = await res.json();

  const squadGroups: { title: string; members: Record<string, unknown>[] }[] | null =
    data?.squad?.squad ?? null;

  // For leagues where FotMob lacks full squad coverage (e.g. smaller Ukrainian clubs),
  // squad.squad is null. Fall back to the last-match lineup from overview.lastLineupStats.
  if (!squadGroups) {
    return fetchTeamPlayersFromLineup(teamId, teamName, data);
  }

  const players: FotMobPlayer[] = [];

  for (const group of squadGroups) {
    const position = SQUAD_GROUP_TO_POSITION[group.title];
    if (!position) continue;

    for (const m of group.members) {
      players.push({
        id: m.id as number,
        name: m.name as string,
        shirtNumber: (m.shirtNumber as number) ?? null,
        position,
        positionLabel: (m.positionIdsDesc as string) ?? group.title,
        nationality: (m.cname as string) ?? '',
        age: (m.age as number) ?? null,
        injured: (m.injured as boolean) ?? false,
        imageUrl: `https://images.fotmob.com/image_resources/playerimages/${m.id}.png`,
        teamName,
        teamId,
        seasonRating: (m.rating as number) ?? null,
        goals: (m.goals as number) ?? 0,
        assists: (m.assists as number) ?? 0,
        yellowCards: (m.ycards as number) ?? 0,
        redCards: (m.rcards as number) ?? 0,
      });
    }
  }

  return players;
}

/**
 * Fallback for teams where FotMob's squad endpoint returns null (e.g. smaller Ukrainian clubs).
 * Extracts starters + subs from overview.lastLineupStats — the most recent match lineup.
 * usualPlayingPositionId: 0=GK, 1=DEF, 2=MID, 3=FWD.
 */
function fetchTeamPlayersFromLineup(
  teamId: number,
  teamName: string,
  data: Record<string, unknown>,
): FotMobPlayer[] {
  const USUAL_POS: Record<number, FotMobPlayer['position']> = {
    0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD',
  };

  type LineupEntry = {
    id?: number;
    name?: string;
    age?: number;
    shirtNumber?: string | number;
    countryName?: string;
    positionId?: number;
    usualPlayingPositionId?: number;
  };

  const lineup = (data?.overview as Record<string, unknown> | null)
    ?.lastLineupStats as { starters?: LineupEntry[]; subs?: LineupEntry[] } | null;

  if (!lineup) return [];

  const all: LineupEntry[] = [...(lineup.starters ?? []), ...(lineup.subs ?? [])];
  const seen = new Set<number>();
  const players: FotMobPlayer[] = [];

  for (const p of all) {
    if (!p.id) continue;
    const id = Number(p.id);
    if (seen.has(id)) continue;
    seen.add(id);

    // Prefer usualPlayingPositionId (general group) over positionId (formation slot)
    const groupNum = p.usualPlayingPositionId ?? (p.positionId === 11 ? 0 : undefined);
    const position: FotMobPlayer['position'] = USUAL_POS[groupNum ?? -1] ?? 'MID';

    players.push({
      id,
      name: p.name ?? '',
      shirtNumber: p.shirtNumber != null ? Number(p.shirtNumber) : null,
      position,
      positionLabel: position,
      nationality: p.countryName ?? '',
      age: p.age ?? null,
      injured: false,
      imageUrl: `https://images.fotmob.com/image_resources/playerimages/${id}.png`,
      teamName,
      teamId,
      seasonRating: null,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
    });
  }

  return players;
}
