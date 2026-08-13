export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getLeagueFixturesCached } from '@/lib/fixturesCache';
import type { Squad } from '@/types/squad';
import type { PlayerRecentMatch } from '@/lib/fotmob';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId });
  if (!saved?.players.length) return NextResponse.json({ form: {} });

  // Use the already-cached league fixtures instead of per-player playerData calls.
  // This gives team results (W/D/L + score + opponent) for the last 5 matches.
  const { matches } = await getLeagueFixturesCached(leagueId, { forceRefresh });

  const finishedDesc = matches
    .filter((m) => m.finished && m.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Cache last-5-matches per team so players on the same team share one slice
  const teamFormCache = new Map<number, PlayerRecentMatch[]>();

  const form: Record<string, PlayerRecentMatch[]> = {};
  for (const p of saved.players) {
    if (!teamFormCache.has(p.teamId)) {
      const last5 = finishedDesc
        .filter((m) => m.homeTeam.id === p.teamId || m.awayTeam.id === p.teamId)
        .slice(0, 5)
        .reverse() // chronological so newest is rightmost in the UI
        .map((m): PlayerRecentMatch => {
          const isHome = m.homeTeam.id === p.teamId;
          const goalsFor     = isHome ? m.homeScore : m.awayScore;
          const goalsAgainst = isHome ? m.awayScore : m.homeScore;
          const opponent = isHome ? m.awayTeam : m.homeTeam;
          let result: 'W' | 'D' | 'L' | null = null;
          if (goalsFor != null && goalsAgainst != null) {
            result = goalsFor > goalsAgainst ? 'W' : goalsFor === goalsAgainst ? 'D' : 'L';
          }
          return {
            matchId: m.matchId,
            date: m.date,
            opponentName: opponent.name,
            opponentId: opponent.id,
            isHome,
            result,
            goalsFor,
            goalsAgainst,
            minutesPlayed: null,
            rating: null,
            goals: 0,
            assists: 0,
            yellowCard: false,
            redCard: false,
            leagueId,
            started: false,
          };
        });
      teamFormCache.set(p.teamId, last5);
    }
    form[String(p.id)] = teamFormCache.get(p.teamId)!;
  }

  return NextResponse.json({ form });
}
