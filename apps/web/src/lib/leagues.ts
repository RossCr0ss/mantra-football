/**
 * Supported leagues. Client-safe (no server imports) — import this instead of
 * `fotmob.ts` in components/pages so the large FotMob module stays out of the client bundle.
 * Adding a league: see docs/adding-a-league.md (`mantraTournamentId` is part of the entry).
 */

export interface FotMobLeague {
  id: number;
  name: string;
  country: string;
  countryCode: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  /** mantrafootball.org tournament id (stable across seasons) — used to fetch official positions / import squads. */
  mantraTournamentId: number;
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
    mantraTournamentId: 2,
  },
  {
    id: 55,
    name: 'Serie A',
    country: 'Italy',
    countryCode: 'IT',
    primaryColor: '#024494',
    secondaryColor: '#000000',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/55.png',
    mantraTournamentId: 1,
  },
  {
    id: 40,
    name: 'First Division A',
    country: 'Belgium',
    countryCode: 'BE',
    primaryColor: '#1a1a2e',
    secondaryColor: '#e94560',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/40.png',
    mantraTournamentId: 13,
  },
  {
    id: 441,
    name: 'Ukrainian Premier League',
    country: 'Ukraine',
    countryCode: 'UA',
    primaryColor: '#005bbb',
    secondaryColor: '#ffd500',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/441.png',
    mantraTournamentId: 15,
  },
  {
    id: 87,
    name: 'LaLiga',
    country: 'Spain',
    countryCode: 'ES',
    primaryColor: '#ee8707',
    secondaryColor: '#a50044',
    logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/87.png',
    mantraTournamentId: 5,
  },
];
