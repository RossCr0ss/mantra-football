import { NextRequest, NextResponse } from 'next/server';
import { fetchMantraTeamRoster, MANTRA_TOURNAMENT_ID } from '@/lib/mantraFootball';
import { getMantraTournamentPlayersCached } from '@/lib/mantraFootballCache';
import {
  getLeagueTeamsCached, getTeamPlayersCached, searchFotMobPlayerCached, getPlayerPrimaryPositionCached,
} from '@/lib/fotmobCache';
import { matchMantraPlayer, clubSimilarity, type MatchCandidate } from '@/lib/nameMatch';
import type { SquadPlayer, MantraPosition } from '@/types/squad';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const sessionCookie = req.cookies.get('mantra_session')?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Not logged in to MantraFootball' }, { status: 401 });
  }

  const { mantraTeamId } = await req.json();
  if (!mantraTeamId) return NextResponse.json({ error: 'mantraTeamId required' }, { status: 400 });

  const tournamentId = MANTRA_TOURNAMENT_ID[leagueId];
  if (tournamentId == null) return NextResponse.json({ error: 'Unsupported league' }, { status: 400 });

  const [{ players: roster, isCurrentSeason }, tournamentPlayers, teams] = await Promise.all([
    fetchMantraTeamRoster(mantraTeamId, sessionCookie),
    getMantraTournamentPlayersCached(tournamentId),
    getLeagueTeamsCached(leagueId),
  ]);

  if (roster.length === 0) {
    return NextResponse.json({ error: 'Empty roster — check the team id or log in again' }, { status: 404 });
  }
  if (!isCurrentSeason) {
    return NextResponse.json(
      { error: 'This team has no roster for the current season yet — add players manually instead.' },
      { status: 409 },
    );
  }

  const clubByMantraId = new Map(tournamentPlayers.map((p) => [p.id, p.clubName]));

  const fotmobPool = (await Promise.all(teams.map((t) => getTeamPlayersCached(t.id, t.name)))).flat();
  const candidates: (MatchCandidate & { player: typeof fotmobPool[number] })[] = fotmobPool.map((p) => ({
    fullName: p.name,
    clubName: p.teamName,
    player: p,
  }));

  const players: SquadPlayer[] = [];
  const stillUnmatched: { fullName: string; clubName: string; positions: MantraPosition[] }[] = [];

  for (const entry of roster) {
    const fullName = `${entry.firstName} ${entry.lastName}`.trim();
    const clubName = clubByMantraId.get(entry.mantraId) ?? '';
    const match = matchMantraPlayer({ name: fullName, teamName: clubName }, candidates);

    if (!match) {
      stillUnmatched.push({ fullName, clubName, positions: entry.positions });
      continue;
    }

    const p = match.player;
    players.push({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      teamName: p.teamName,
      position: p.positionLabel,
      positionGroup: p.position,
      imageUrl: p.imageUrl,
      injured: p.injured,
      mantraPositions: entry.positions,
    });
  }

  // Fallback for players a team's own roster listing is missing entirely (confirmed
  // live: FotMob's squad.squad is sometimes null for a whole club, silently hiding
  // real members like Eguinaldo/Marlon Gomes from the candidate pool above no matter
  // how good the name match would be) — FotMob's own name search sidesteps that
  // endpoint completely. It isn't nickname-fuzzy the way matchMantraPlayer is, so
  // this only catches names mantrafootball.org already spells the FotMob way.
  const usedIds = new Set(players.map((p) => p.id));
  const unmatched: string[] = [];

  for (const entry of stillUnmatched) {
    const results = await searchFotMobPlayerCached(entry.fullName);
    const candidatesByClub = results
      .filter((r) => !usedIds.has(r.id))
      .map((r) => ({ result: r, clubSim: clubSimilarity(entry.clubName, r.teamName) }))
      .sort((a, b) => b.clubSim - a.clubSim);
    const best = candidatesByClub[0];

    if (!best || best.clubSim < 0.5) {
      unmatched.push(entry.fullName);
      continue;
    }

    const pos = await getPlayerPrimaryPositionCached(best.result.id);
    usedIds.add(best.result.id);
    players.push({
      id: best.result.id,
      name: best.result.name,
      teamId: best.result.teamId,
      teamName: best.result.teamName,
      position: pos?.label ?? entry.positions[0] ?? '',
      positionGroup: pos?.group ?? 'MID',
      imageUrl: `https://images.fotmob.com/image_resources/playerimages/${best.result.id}.png`,
      injured: false,
      mantraPositions: entry.positions,
    });
  }

  return NextResponse.json({ players, unmatched });
}
