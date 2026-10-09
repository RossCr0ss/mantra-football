import type { SquadPlayer, MantraPosition, PositionGroup } from '@/types/squad';
import type { LeagueMatch } from '@/lib/fotmob';
import type { PlayerRecentMatch } from '@/lib/fotmob';

/** Test factories — keep in sync with the domain types. */
export function makePlayer(over: Partial<SquadPlayer> & { id: number }): SquadPlayer {
  return {
    name: `Player ${over.id}`,
    teamId: 1,
    teamName: 'Team',
    position: 'CM',
    positionGroup: 'MID' as PositionGroup,
    imageUrl: '',
    mantraPositions: ['CM'] as MantraPosition[],
    ...over,
  };
}

export function makeMatch(over: Partial<LeagueMatch> & { matchId: string; homeId: number; awayId: number }): LeagueMatch {
  const { homeId, awayId, ...rest } = over;
  return {
    date: '2026-01-01T15:00:00Z',
    round: '1',
    homeTeam: { id: homeId, name: `T${homeId}`, logoUrl: '' },
    awayTeam: { id: awayId, name: `T${awayId}`, logoUrl: '' },
    finished: false,
    homeScore: null,
    awayScore: null,
    ...rest,
  };
}

export function makeForm(over: Partial<PlayerRecentMatch> = {}): PlayerRecentMatch {
  return {
    matchId: 'm', date: '2026-01-01', opponentName: 'Opp', opponentId: 2, isHome: true,
    result: 'W', goalsFor: 1, goalsAgainst: 0, minutesPlayed: 90, rating: 7, goals: 0, assists: 0,
    yellowCard: false, redCard: false, leagueId: 47, started: true, ...over,
  };
}
