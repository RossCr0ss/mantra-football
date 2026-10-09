import { NextRequest, NextResponse } from 'next/server';
import { parseIdParam, apiError } from '@/lib/apiUtils';
import { getPlayerCurrentTeamCached } from '@/lib/fotmobCache';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const playerId = parseIdParam(params.id);
  if (playerId === null) return apiError('Invalid player id');

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const team = await getPlayerCurrentTeamCached(playerId, { forceRefresh });
  return NextResponse.json({ team });
}
