import { NextRequest, NextResponse } from 'next/server';
import { getTeamPlayersCached } from '@/lib/fotmobCache';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const teamId = Number(params.id);
  const teamName = req.nextUrl.searchParams.get('teamName') ?? '';
  if (!teamId) return NextResponse.json({ error: 'Invalid teamId' }, { status: 400 });

  const players = await getTeamPlayersCached(teamId, teamName);
  return NextResponse.json({ players });
}
