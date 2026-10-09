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
