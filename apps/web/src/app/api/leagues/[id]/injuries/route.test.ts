import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mongodb', () => ({ getDb: async () => ({ collection: () => ({ findOne: async () => squad }) }) }));
vi.mock('@/lib/injuries', () => ({ getPlayerInjuriesBatch: vi.fn() }));

import { getPlayerInjuriesBatch } from '@/lib/injuries';
import { GET } from './route';
import { NextRequest } from 'next/server';

let squad: { players: { id: number; teamId: number; teamName: string }[] } | null = null;
const call = (id: string) => GET(new NextRequest('http://x/api'), { params: { id } });

beforeEach(() => { squad = null; vi.clearAllMocks(); });

describe('GET /api/leagues/[id]/injuries', () => {
  it('rejects unknown leagues', async () => {
    expect((await call('999')).status).toBe(404);
    expect((await call('abc')).status).toBe(404);
  });

  it('returns only injured players, keyed by id', async () => {
    squad = { players: [{ id: 1, teamId: 9, teamName: 'T' }, { id: 2, teamId: 9, teamName: 'T' }] };
    vi.mocked(getPlayerInjuriesBatch).mockResolvedValue({ 1: { name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null }, 2: null });
    const res = await call('47');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ injuries: { 1: { name: 'Injured', expectedReturn: null, expectedReturnDate: null, lastUpdated: null } } });
  });

  it('returns an empty map when there is no saved squad', async () => {
    vi.mocked(getPlayerInjuriesBatch).mockResolvedValue({});
    expect(await (await call('47')).json()).toEqual({ injuries: {} });
    expect(getPlayerInjuriesBatch).toHaveBeenCalledWith([]);
  });
});
