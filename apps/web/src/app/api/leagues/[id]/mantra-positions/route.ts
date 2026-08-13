import { NextRequest, NextResponse } from 'next/server';
import { MANTRA_TOURNAMENT_ID } from '@/lib/mantraFootball';
import { getMantraTournamentPlayersCached } from '@/lib/mantraFootballCache';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const tournamentId = MANTRA_TOURNAMENT_ID[leagueId];
  if (tournamentId == null) return NextResponse.json({ players: [] });

  const players = await getMantraTournamentPlayersCached(tournamentId);
  return NextResponse.json({ players });
}
