import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fotmobFetch, FOTMOB_HEADERS } from './http';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

const lastInit = () => fetchMock.mock.calls.at(-1)![1] as RequestInit & { headers: Record<string, string> };

describe('fotmobFetch', () => {
  it('uses default headers, no Next cache and a timeout signal', async () => {
    await fotmobFetch('https://www.fotmob.com/api/data/leagues?id=47');
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.fotmob.com/api/data/leagues?id=47');
    expect(lastInit().headers).toEqual(FOTMOB_HEADERS);
    expect(lastInit().cache).toBe('no-store');
    expect(lastInit().signal).toBeInstanceOf(AbortSignal);
  });

  it("'cdn' adds gzip encoding", async () => {
    await fotmobFetch('https://data.fotmob.com/x.json', 'cdn');
    expect(lastInit().headers['Accept-Encoding']).toBe('gzip');
  });

  it("'player' adds the FOTMOB_COOKIE only when set", async () => {
    await fotmobFetch('u', 'player');
    expect(lastInit().headers.Cookie).toBeUndefined();
    vi.stubEnv('FOTMOB_COOKIE', 'abc=1');
    await fotmobFetch('u', 'player');
    expect(lastInit().headers.Cookie).toBe('abc=1');
  });

  it('aborts after the timeout', async () => {
    await fotmobFetch('u', 'default', 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(lastInit().signal!.aborted).toBe(true);
  });
});
