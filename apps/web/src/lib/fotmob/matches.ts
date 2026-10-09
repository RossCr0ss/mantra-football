import { fotmobFetch } from './http';
import type { FixtureOdds, MatchCardEvent } from './types';

/**
 * Card events for a single finished match, from the match-detail endpoint's
 * event timeline — the only place FotMob exposes per-match disciplinary data.
 * Used to reconstruct season-long card accumulation (see suspensionCheck.ts),
 * since neither the team-squad endpoint nor the season CDN stat lists carry
 * this reliably yet this early in a season.
 */
export async function fetchMatchCardEvents(matchId: string): Promise<MatchCardEvent[]> {
  try {
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`);
    if (!res.ok) return [];
    const data = await res.json();
    const events = data?.content?.matchFacts?.events?.events ?? [];
    if (!Array.isArray(events)) return [];

    const cards: MatchCardEvent[] = [];
    for (const e of events) {
      if (e?.type !== 'Card') continue;
      if (e.card !== 'Yellow' && e.card !== 'Red' && e.card !== 'YellowRed') continue;
      const playerId = e.playerId ?? e.player?.id;
      if (!playerId) continue;
      cards.push({
        playerId: Number(playerId),
        playerName: e.fullName ?? e.player?.name ?? e.nameStr ?? '',
        card: e.card,
        minute: Number(e.time ?? 0),
      });
    }
    return cards;
  } catch {
    return [];
  }
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
    const res = await fotmobFetch(`https://www.fotmob.com/api/data/matchOdds?matchId=${matchId}&ccode3=${ccode3}&bettingProvider=${provider}`);
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
