import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = { data: unknown; cachedAt: Date; [k: string]: unknown };
let doc: Doc | null = null;
const col = {
  findOne: vi.fn(async () => doc),
  updateOne: vi.fn(async (_f: unknown, u: { $set: Doc }) => { doc = u.$set; }),
};
vi.mock('./mongodb', () => ({ getDb: async () => ({ collection: () => col }) }));

import { withCache, MIN_FORCE_REFRESH_MS } from './mongoCache';

const TTL = { freshMs: 1_000, staleMs: 10_000 };
const ageMs = (ms: number) => new Date(Date.now() - ms);
const call = (fetcher: () => Promise<string>, forceRefresh = false) =>
  withCache('c', { id: 1 }, TTL, fetcher, { forceRefresh });

beforeEach(() => { doc = null; vi.clearAllMocks(); });

describe('withCache', () => {
  it('fetches and stores on a miss', async () => {
    const f = vi.fn().mockResolvedValue('new');
    expect(await call(f)).toBe('new');
    expect(f).toHaveBeenCalledTimes(1);
    expect(doc?.data).toBe('new');
  });

  it('serves a fresh doc without fetching', async () => {
    doc = { data: 'cached', cachedAt: ageMs(100) };
    const f = vi.fn();
    expect(await call(f)).toBe('cached');
    expect(f).not.toHaveBeenCalled();
  });

  it('serves a stale doc immediately and refreshes in the background (deduplicated)', async () => {
    doc = { data: 'old', cachedAt: ageMs(5_000) };
    let release!: (v: string) => void;
    const f = vi.fn(() => new Promise<string>((r) => { release = r; }));
    expect(await call(f)).toBe('old');
    expect(await call(f)).toBe('old'); // refresh still in flight → no second fetch
    expect(f).toHaveBeenCalledTimes(1);
    release('newer');
    await vi.waitFor(() => expect(doc?.data).toBe('newer'));
  });

  it('fetches synchronously past staleMs and falls back to stale data when the fetch fails', async () => {
    doc = { data: 'ancient', cachedAt: ageMs(60_000) };
    expect(await call(vi.fn().mockResolvedValue('fresh'))).toBe('fresh');
    doc = { data: 'ancient', cachedAt: ageMs(60_000) };
    expect(await call(vi.fn().mockRejectedValue(new Error('down')))).toBe('ancient');
  });

  it('treats an empty array as a miss', async () => {
    doc = { data: [], cachedAt: ageMs(10) };
    const f = vi.fn().mockResolvedValue(['x']);
    expect(await withCache('c', { id: 1 }, TTL, f)).toEqual(['x']);
  });

  describe('forceRefresh', () => {
    it('refetches when the doc is older than the minimum interval', async () => {
      doc = { data: 'old', cachedAt: ageMs(MIN_FORCE_REFRESH_MS + 1_000) };
      const f = vi.fn().mockResolvedValue('forced');
      expect(await call(f, true)).toBe('forced');
      expect(f).toHaveBeenCalledTimes(1);
    });

    it('is ignored (cached data served) when the doc was refreshed moments ago', async () => {
      doc = { data: 'just-refreshed', cachedAt: ageMs(1_000) };
      const f = vi.fn().mockResolvedValue('forced');
      expect(await call(f, true)).toBe('just-refreshed');
      expect(f).not.toHaveBeenCalled();
    });

    it('still fetches when nothing is cached', async () => {
      const f = vi.fn().mockResolvedValue('forced');
      expect(await call(f, true)).toBe('forced');
    });
  });
});
