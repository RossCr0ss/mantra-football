import type { SquadPlayer } from '@/types/squad';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import { isInjuryActive } from '@/lib/injuryDate';

/**
 * Overlays live injury data on the saved squad for tour selection: a player with an active injury
 * (FotMob `injured` flag or a manual override that has not expired, see isInjuryActive) and no
 * manual `lineupStatus` is treated as `injured` (source 'auto'), which excludes them from
 * auto-select. A manual `lineupStatus` (injured/suspended) always wins; "Healed" (cleared) lifts it.
 * Pure — nothing is persisted.
 */
export function applyLiveInjuries(
  squad: SquadPlayer[],
  injuries: Record<number, PlayerInjuryInfo | null | undefined>,
  now: Date = new Date(),
): SquadPlayer[] {
  return squad.map((p) =>
    !p.lineupStatus && isInjuryActive(injuries[p.id], now)
      ? { ...p, lineupStatus: 'injured', lineupStatusSource: 'auto' }
      : p,
  );
}
