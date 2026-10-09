export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import type { TeamFixture } from '@/lib/fotmob';
import { getLeagueFixturesCached, buildTeamFixtures } from '@/lib/fixturesCache';
import { getDb } from '@/lib/mongodb';
import type { Squad } from '@/types/squad';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);
  const leagueId = league.id;

  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId });
  const players = saved?.players ?? [];

  if (!players.length) return NextResponse.json({ fixtures: {}, cachedAt: null });

  const teamIds = Array.from(new Set(players.map((p) => p.teamId)));
  const { matches, tablePositions, currentRound, cachedAt } =
    await getLeagueFixturesCached(leagueId, { forceRefresh });

  const fixtures: Record<number, TeamFixture[]> = {};
  teamIds.forEach((id) => {
    fixtures[id] = buildTeamFixtures(id, matches, tablePositions, currentRound);
  });

  return NextResponse.json({ fixtures, currentRound, cachedAt });
}
