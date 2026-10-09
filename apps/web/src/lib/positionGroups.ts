import type { SquadPlayer, PositionGroup } from '@/types/squad';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';

export const POSITION_ORDER: Record<PositionGroup, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export const POSITION_SECTIONS: { group: PositionGroup; label: string }[] = [
  { group: 'GK',  label: 'Goalkeepers' },
  { group: 'DEF', label: 'Defenders'   },
  { group: 'MID', label: 'Midfielders' },
  { group: 'FWD', label: 'Forwards'    },
];

export const POSITION_RING: Record<string, string> = {
  GK:  'ring-yellow-400/35',
  DEF: 'ring-sky-400/35',
  MID: 'ring-emerald-400/35',
  FWD: 'ring-orange-400/35',
};

/**
 * Derives the effective position group from manual Mantra positions.
 * Mantra positions take priority over FotMob's broad positionGroup so that
 * a player manually tagged as CB/DM (DEF) is never treated as a midfielder
 * even if FotMob classifies them as MID.
 */
export function effectivePositionGroup(player: SquadPlayer): PositionGroup {
  if (player.mantraPositions.length > 0) {
    const def = MANTRA_POSITIONS.find((d) => d.code === player.mantraPositions[0]);
    if (def) return def.group;
  }
  return player.positionGroup;
}
