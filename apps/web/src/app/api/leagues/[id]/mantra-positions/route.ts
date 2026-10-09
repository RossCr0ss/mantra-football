import { NextRequest, NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import { MANTRA_TOURNAMENT_ID } from '@/lib/mantraFootball';
import { getMantraTournamentPlayersCached } from '@/lib/mantraFootballCache';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);
  const leagueId = league.id;

  const tournamentId = MANTRA_TOURNAMENT_ID[leagueId];
  if (tournamentId == null) return NextResponse.json({ players: [] });

  const players = await getMantraTournamentPlayersCached(tournamentId);
  return NextResponse.json({ players });
}
