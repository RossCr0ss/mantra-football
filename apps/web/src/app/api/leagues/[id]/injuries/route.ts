export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import { getDb } from '@/lib/mongodb';
import { getPlayerInjuriesBatch } from '@/lib/injuries';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import type { Squad } from '@/types/squad';

/** Current injury info (manual override → live FotMob flag) for every saved squad player; healthy players are omitted. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId: league.id });
  const batch = await getPlayerInjuriesBatch(saved?.players ?? []);

  const injuries: Record<number, PlayerInjuryInfo> = {};
  for (const [id, info] of Object.entries(batch)) if (info) injuries[Number(id)] = info;
  return NextResponse.json({ injuries });
}
