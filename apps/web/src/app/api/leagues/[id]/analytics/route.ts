export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getSquadSeasonStats } from '@/lib/squadStats';
import { getCachedAt } from '@/lib/mongoCache';
import type { PlayerSeasonStats } from '@/lib/fotmob';
import type { Squad, MantraPosition } from '@/types/squad';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';

export interface PlayerAnalytics extends PlayerSeasonStats {
  name: string;
  teamName: string;
  teamId: number;
  /** FotMob position label — use as fallback when mantraPositions is empty */
  position: string;
  /** Effective group: derived from mantraPositions[0] when set, else FotMob positionGroup */
  positionGroup: string;
  imageUrl: string;
  mantraPositions: MantraPosition[];
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  const opts = { forceRefresh };

  const db = await getDb();
  const saved = await db.collection<Squad>('squads').findOne({ leagueId });
  if (!saved?.players.length) return NextResponse.json({ players: [], dataUpdatedAt: null });

  const allStats = await getSquadSeasonStats(leagueId, saved.players, opts);

  const players: PlayerAnalytics[] = saved.players.map((p) => {
    const s = allStats.get(p.id);
    const mantraPositions: MantraPosition[] = p.mantraPositions ?? [];
    const effectiveGroup = mantraPositions.length > 0
      ? (MANTRA_POSITIONS.find((d) => d.code === mantraPositions[0])?.group ?? p.positionGroup)
      : p.positionGroup;
    return {
      playerId:              p.id,
      name:                  p.name,
      teamName:              p.teamName,
      teamId:                p.teamId,
      position:              p.position,
      positionGroup:         effectiveGroup,
      imageUrl:              p.imageUrl,
      mantraPositions,
      rating:                s?.rating              ?? null,
      goals:                 s?.goals               ?? 0,
      assists:               s?.assists             ?? 0,
      yellowCards:           s?.yellowCards         ?? 0,
      redCards:              s?.redCards            ?? 0,
      leagueRank:            s?.leagueRank          ?? null,
      matchesPlayed:         s?.matchesPlayed       ?? 0,
      minutesPlayed:         s?.minutesPlayed       ?? 0,
      cleanSheets:           s?.cleanSheets         ?? 0,
      saves:                 s?.saves               ?? 0,
      goalsConceded:         s?.goalsConceded       ?? 0,
      savePercentage:        s?.savePercentage      ?? null,
      goalsPrevented:        s?.goalsPrevented      ?? null,
      penaltySaves:          s?.penaltySaves        ?? null,
      actedSweeper:          s?.actedSweeper        ?? null,
      highClaims:            s?.highClaims          ?? null,
      errorLeadToGoal:       s?.errorLeadToGoal     ?? null,
      tackles:               s?.tackles             ?? null,
      interceptions:         s?.interceptions       ?? null,
      clearances:            s?.clearances          ?? null,
      blockedShots:          s?.blockedShots        ?? null,
      aerialsWon:            s?.aerialsWon          ?? null,
      foulsCommitted:        s?.foulsCommitted      ?? null,
      possessionWonFinal3rd: s?.possessionWonFinal3rd ?? null,
      dribbledPast:          s?.dribbledPast        ?? null,
      expectedGoals:         s?.expectedGoals       ?? null,
      shots:                 s?.shots               ?? null,
      chancesCreated:        s?.chancesCreated      ?? null,
      successfulDribbles:    s?.successfulDribbles  ?? null,
      bigChancesCreated:     s?.bigChancesCreated   ?? null,
      bigChancesMissed:      s?.bigChancesMissed    ?? null,
    };
  });

  const firstTeamId = saved.players[0]?.teamId;
  const dataUpdatedAt = firstTeamId
    ? await getCachedAt('fotmob_stats', { teamId: firstTeamId })
    : null;

  return NextResponse.json({ players, dataUpdatedAt: dataUpdatedAt?.toISOString() ?? null });
}
