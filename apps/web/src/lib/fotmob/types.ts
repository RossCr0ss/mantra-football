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

export interface PlayerCurrentTeam {
  teamId: number;
  teamName: string;
}

export interface FotMobSearchResult {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
}

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

export interface MatchCardEvent {
  playerId: number;
  playerName: string;
  /** 'YellowRed' = second yellow in the same match, not a straight red */
  card: 'Yellow' | 'Red' | 'YellowRed';
  minute: number;
}
