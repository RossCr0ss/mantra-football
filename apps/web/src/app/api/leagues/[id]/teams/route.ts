import { NextRequest, NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import { getLeagueTeamsCached } from '@/lib/fotmobCache';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);
  const leagueId = league.id;

  const teams = await getLeagueTeamsCached(leagueId);
  return NextResponse.json({ teams });
}
