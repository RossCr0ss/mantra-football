import { NextResponse } from 'next/server';
import { LEAGUES, type FotMobLeague } from '@/lib/leagues';

/** Strict positive-integer id parse. `parseInt('12abc')` → 12 and `Number('')` → 0 are both rejected here. */
export function parseIdParam(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Supported league for a numeric id, or null. Guards against fetching/caching arbitrary FotMob league ids. */
export function findLeague(id: number | null | undefined): FotMobLeague | null {
  return id == null ? null : (LEAGUES.find((l) => l.id === id) ?? null);
}

/** `[id]` route param → supported league (or null). */
export function parseLeagueParam(raw: string | null | undefined): FotMobLeague | null {
  return findLeague(parseIdParam(raw));
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
