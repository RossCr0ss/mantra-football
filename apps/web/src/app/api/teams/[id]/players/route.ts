import { NextRequest, NextResponse } from 'next/server';
import { parseIdParam, apiError } from '@/lib/apiUtils';
import { getTeamPlayersCached } from '@/lib/fotmobCache';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const teamId = parseIdParam(params.id);
  const teamName = req.nextUrl.searchParams.get('teamName') ?? '';
  if (teamId === null) return apiError('Invalid teamId');

  const players = await getTeamPlayersCached(teamId, teamName);
  return NextResponse.json({ players });
}
