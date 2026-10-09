/** sessionStorage cache with TTL for client pages (analytics, fixtures, form). Fails silent (SSR/private mode). */
const CACHE_TTL_MS = 15 * 60 * 1000;

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number };
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

export function cacheSet<T>(key: string, data: T): void {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

/**
 * sessionStorage keys per league. `v2:` — stores the full API response (earlier versions stored
 * narrowed shapes under `anl_`/`fix_`/`form_`; the prefix keeps stale entries from being misread).
 */
export const CACHE_KEY = {
  analytics: (leagueId: number) => `v2:anl_${leagueId}`,
  fixtures:  (leagueId: number) => `v2:fix_${leagueId}`,
  form:      (leagueId: number) => `v2:form_${leagueId}`,
};

/**
 * GET JSON with a 15-min sessionStorage cache in front.
 * `refresh: true` skips the session cache AND asks the server to bypass its Mongo cache (`?refresh=1`),
 * then stores the fresh response. Rejects on network errors and non-2xx responses.
 */
export async function fetchJsonCached<T>(
  key: string,
  url: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<T> {
  if (!refresh) {
    const hit = cacheGet<T>(key);
    if (hit !== null) return hit;
  }
  const res = await fetch(refresh ? `${url}${url.includes('?') ? '&' : '?'}refresh=1` : url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const data = (await res.json()) as T;
  cacheSet(key, data);
  return data;
}
