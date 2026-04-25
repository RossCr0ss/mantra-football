export type PlayerPosition =
  | 'GK'
  | 'DEF'
  | 'MID'
  | 'ATT';

export type PlayerRole =
  | 'goalkeeper'
  | 'defender'
  | 'midfielder'
  | 'forward';

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition;
  role: PlayerRole;
  /** Mantra rating 1-10 */
  rating: number;
  team: string;
  /** Fanta points from last N matches */
  recentPoints: number[];
  averagePoints: number;
  isInjured: boolean;
  isDisqualified: boolean;
}
