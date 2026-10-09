import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheGet, cacheSet, fetchJsonCached, CACHE_KEY } from './clientCache';

const store = new Map<string, string>();
const fetchMock = vi.fn();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ players: [1] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fetchMock.mockReset(); });

describe('cacheGet/cacheSet', () => {
  it('round-trips and expires after 15 minutes', () => {
    vi.useFakeTimers();
    cacheSet('k', { a: 1 });
    expect(cacheGet('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(cacheGet('k')).toBeNull();
  });

  it('returns null (not throw) when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(cacheGet('k')).toBeNull();
    expect(() => cacheSet('k', 1)).not.toThrow();
  });
});

describe('fetchJsonCached', () => {
  const key = CACHE_KEY.analytics(47);

  it('fetches once, then serves from the session cache', async () => {
    expect(await fetchJsonCached(key, '/api/x')).toEqual({ players: [1] });
    expect(await fetchJsonCached(key, '/api/x')).toEqual({ players: [1] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresh bypasses the cache, adds ?refresh=1 (or &refresh=1) and stores the new response', async () => {
    cacheSet(key, { players: ['stale'] });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ players: ['fresh'] })));
    expect(await fetchJsonCached(key, '/api/x', { refresh: true })).toEqual({ players: ['fresh'] });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/x?refresh=1');
    expect(cacheGet(key)).toEqual({ players: ['fresh'] });

    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await fetchJsonCached(key, '/api/x?a=1', { refresh: true });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/x?a=1&refresh=1');
  });

  it('rejects on non-2xx and does not cache the failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(fetchJsonCached(key, '/api/x')).rejects.toThrow('500');
    expect(cacheGet(key)).toBeNull();
  });

  it('uses distinct, versioned keys per resource and league', () => {
    expect(CACHE_KEY.form(47)).not.toBe(CACHE_KEY.form(55));
    expect(CACHE_KEY.analytics(47)).toMatch(/^v2:/);
  });
});
