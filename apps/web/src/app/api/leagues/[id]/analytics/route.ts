export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  getLeagueTeamsCached,
  getTeamPlayerStatsCached,
  getLeagueRatingStatsCached,
  getLeagueSeasonIdCached,
  getLeagueStatsListCached,
  getPlayerSeasonStatsCached,
} from '@/lib/fotmobCache';
import { getCachedAt } from '@/lib/mongoCache';
import type { FotMobTeam, PlayerSeasonStats } from '@/lib/fotmob';
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

  const leagueTeams = await getLeagueTeamsCached(leagueId, opts).catch((): FotMobTeam[] => []);
  const teamNameToId = new Map<string, number>(leagueTeams.map((t) => [t.name, t.id]));

  const byTeam = new Map<number, { teamName: string; playerIds: Set<number> }>();
  for (const p of saved.players) {
    const teamId = p.teamId || teamNameToId.get(p.teamName);
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, { teamName: p.teamName, playerIds: new Set() });
    byTeam.get(teamId)!.playerIds.add(p.id);
  }

  // ── Fetch base stats (rating/goals/assists/cards) from team squad endpoint ──
  const teamStatMaps = await Promise.all(
    Array.from(byTeam.entries()).map(([teamId, { teamName }]) =>
      getTeamPlayerStatsCached(teamId, teamName, opts).then((m) => ({ teamId, map: m })),
    ),
  );

  const allStats = new Map<number, PlayerSeasonStats>();
  for (const { map } of teamStatMaps) {
    map.forEach((stats, id) => allStats.set(id, stats));
  }

  // ── Fetch leagueRank / matchesPlayed / minutesPlayed from rating.json ────────
  const seasonId = await getLeagueSeasonIdCached(leagueId, opts);
  if (seasonId) {
    const rankMap = await getLeagueRatingStatsCached(leagueId, seasonId, opts);
    rankMap.forEach((rank, id) => {
      const s = allStats.get(id);
      if (s) {
        s.leagueRank    = rank.leagueRank;
        s.matchesPlayed = rank.matchesPlayed;
        s.minutesPlayed = rank.minutesPlayed;
      }
    });
  }

  // ── Fetch available CDN stat lists (try all; empty Map returned on 403) ─────
  if (seasonId) {
    const subStat = (key: string) =>
      getLeagueStatsListCached(leagueId, seasonId!, key, { ...opts, useSubStatValue: true })
        .catch(() => new Map<number, number>());

    const [interceptionsMap, savesMap] = await Promise.all([
      subStat('interception'),
      subStat('saves'),
    ]);

    interceptionsMap.forEach((v, id) => { const s = allStats.get(id); if (s) s.interceptions = v; });
    savesMap.forEach(        (v, id) => { const s = allStats.get(id); if (s) s.saves          = v; });
  }

  // ── Enrich with full per-player stats from playerData (requires FOTMOB_COOKIE) ─
  if (process.env.FOTMOB_COOKIE) {
    const enrichResults = await Promise.allSettled(
      saved.players.map((p) => getPlayerSeasonStatsCached(p.id, opts)),
    );
    saved.players.forEach((p, i) => {
      const r = enrichResults[i];
      if (r.status !== 'fulfilled') return;
      const detail = r.value;
      const existing = allStats.get(p.id);
      if (!existing) return;
      for (const [k, v] of Object.entries(detail)) {
        if (v != null) (existing as unknown as Record<string, unknown>)[k] = v;
      }
    });
  }

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

  const firstTeamId = Array.from(byTeam.keys())[0];
  const dataUpdatedAt = firstTeamId
    ? await getCachedAt('fotmob_stats', { teamId: firstTeamId })
    : null;

  return NextResponse.json({ players, dataUpdatedAt: dataUpdatedAt?.toISOString() ?? null });
}
