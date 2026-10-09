import type { PlayerInjuryInfo } from '@/lib/fotmob';

/** True when the expected return date is today (player may be back — show "returning" hint). */
export function isReturningToday(info: PlayerInjuryInfo): boolean {
  const dateStr = info.expectedReturnDate ?? info.expectedReturn;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Is this injury record still keeping the player out? False when the user marked the player healed
 * (`cleared`) or the expected return date is today or in the past (override left behind, or FotMob
 * data that has expired). Records without a date (FotMob only exposes an `injured` flag) stay active.
 */
export function isInjuryActive(info: PlayerInjuryInfo | null | undefined, now: Date = new Date()): boolean {
  if (!info || info.cleared) return false;
  const dateStr = info.expectedReturnDate;
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  return startOfDay(d) > startOfDay(now);
}
