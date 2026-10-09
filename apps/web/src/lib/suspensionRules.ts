/**
 * Client-safe suspension constants (suspensionCheck.ts pulls in server-only MongoDB code).
 *
 * Best-effort default: most European domestic leagues ban a player for one
 * match on their 5th accumulated yellow card of the season (Premier League,
 * Serie A, LaLiga all use 5 as the first threshold; exact reset behaviour
 * after that point differs by competition and isn't modelled here).
 * Deliberately NOT used to auto-set `lineupStatus` — surfaced as a warning
 * only, since getting an accumulation-based ban wrong would wrongly bench
 * an available player. A red card is the one case with no such ambiguity.
 */
export const YELLOW_CARD_BAN_THRESHOLD = 5;

/** Show a "one yellow away from a ban" warning from this many yellows. */
export const YELLOW_CARD_WARNING_THRESHOLD = YELLOW_CARD_BAN_THRESHOLD - 1;
