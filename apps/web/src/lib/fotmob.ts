/**
 * FotMob API wrapper — barrel. Implementation lives in `./fotmob/*`:
 * types, http (headers), cdnStats, league, teams, players, matches.
 * Import from '@/lib/fotmob' (server code) or, in client code, directly from
 * '@/lib/fotmob/matches' (`fetchMatchOddsClient`) / `import type` from here.
 */
export * from './fotmob/types';
export * from './fotmob/http';
export * from './fotmob/cdnStats';
export * from './fotmob/league';
export * from './fotmob/teams';
export * from './fotmob/players';
export * from './fotmob/matches';
