import { NextRequest, NextResponse } from 'next/server';
import { getLeagueTeamsCached } from '@/lib/fotmobCache';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const teams = await getLeagueTeamsCached(leagueId);
  return NextResponse.json({ teams });
}
