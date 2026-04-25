export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getPlayerFormCached } from '@/lib/fotmobCache';
import type { Squad } from '@/types/squad';
import type { PlayerRecentMatch } from '@/lib/fotmob';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const opts = { forceRefresh };

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId });
  if (!saved?.players.length) return NextResponse.json({ form: {} });

  const results = await Promise.all(
    saved.players.map((p) =>
      getPlayerFormCached(p.id, opts)
        .then((matches) => ({ id: p.id, matches }))
        .catch(() => ({ id: p.id, matches: [] as PlayerRecentMatch[] })),
    ),
  );

  const form: Record<string, PlayerRecentMatch[]> = {};
  for (const { id, matches } of results) {
    form[String(id)] = matches;
  }

  return NextResponse.json({ form });
}
