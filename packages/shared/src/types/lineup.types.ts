import { Player } from './player.types';

export type Formation =
  | '3-4-3'
  | '3-5-2'
  | '4-3-3'
  | '4-4-2'
  | '4-5-1'
  | '5-3-2'
  | '5-4-1';

export interface LineupSlot {
  position: number;
  player: Player | null;
  isStarter: boolean;
}

export interface Lineup {
  id: string;
  tournamentId: string;
  formation: Formation;
  starters: LineupSlot[];
  bench: LineupSlot[];
  captain: string | null;
  viceCaptain: string | null;
  expectedPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface LineupSuggestion {
  lineup: Lineup;
  score: number;
  reasoning: string[];
}
