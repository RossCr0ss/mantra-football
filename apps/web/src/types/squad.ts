export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

/** Per-matchday availability status set manually by the user. */
export type LineupStatus = 'injured' | 'suspended';

export type MantraPosition =
  | 'GK'
  | 'RB' | 'CB' | 'LB' | 'WB'
  | 'DM' | 'CM' | 'W' | 'AM'
  | 'FW' | 'ST';

export interface SquadPlayer {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
  /** Detailed label, e.g. "CB", "CAM", "GK" */
  position: string;
  /** Broad group used for validation and grouping */
  positionGroup: PositionGroup;
  imageUrl: string;
  injured?: boolean;
  /** One or more Mantra fantasy positions this player can fill */
  mantraPositions: MantraPosition[];
  /** Manually set availability for the next matchday */
  lineupStatus?: LineupStatus;
  /** Expected playing time as % (0–100). 100 = certain full-match starter. Default: 100. */
  availabilityPct?: number;
}

export interface Squad {
  leagueId: number;
  players: SquadPlayer[];
  updatedAt: string;
}

export const SQUAD_RULES = {
  total: 26,
  goalkeepers: 3,
} as const;

export interface TourSelection {
  leagueId: number;
  /** Round label, e.g. "32" or "Round 32" */
  round: string | null;
  /** 11 player IDs: exactly 1 GK + 10 outfield */
  main: number[];
  /** 9 substitute player IDs (min 1 GK required) */
  substitutes: number[];
}
