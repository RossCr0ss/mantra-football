import { NextRequest, NextResponse } from 'next/server';
import { getPlayerCurrentTeamCached } from '@/lib/fotmobCache';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const team = await getPlayerCurrentTeamCached(playerId, { forceRefresh });
  return NextResponse.json({ team });
}
