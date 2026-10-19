import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const updateOne = vi.fn();
let stored: unknown[] = [];
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: () => ({
      updateOne,
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => stored }) }) }),
    }),
  }),
}));

import { GET, POST } from './route';

const post = (id: string, body: unknown) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: { id } });
const valid = { round: '7', formation: '4-4-2', defenceBonus: 1, slots: Array.from({ length: 11 }, (_, i) => i + 1), penalty: [], players: [] };

beforeEach(() => { vi.clearAllMocks(); stored = []; });

describe('POST /api/leagues/[id]/tour-log', () => {
  it('rejects unknown leagues and malformed bodies', async () => {
    expect((await post('999', valid)).status).toBe(404);
    expect((await post('47', 'not json')).status).toBe(400);
    expect((await post('47', { ...valid, slots: [1, 2] })).status).toBe(400);
    expect((await post('47', { ...valid, round: '' })).status).toBe(400);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('upserts one document per league and round', async () => {
    expect((await post('47', valid)).status).toBe(200);
    const [filter, update, opts] = updateOne.mock.calls[0];
    expect(filter).toEqual({ leagueId: 47, round: '7' });
    expect(update.$set).toMatchObject({ leagueId: 47, round: '7', formation: '4-4-2' });
    expect(update.$setOnInsert.createdAt).toBeTruthy();
    expect(opts).toEqual({ upsert: true });
  });
});

describe('GET /api/leagues/[id]/tour-log', () => {
  it('returns the stored logs', async () => {
    stored = [{ round: '7' }];
    const res = await GET(new NextRequest('http://x/api'), { params: { id: '47' } });
    expect(await res.json()).toEqual({ logs: [{ round: '7' }] });
  });
});
