import type { PositionGroup } from '@/types/squad';

export function scoreTier(score: number) {
  if (score >= 31) return { bg: 'bg-emerald-500/20', text: 'text-emerald-300', ring: 'ring-emerald-500/40' };
  if (score >= 18) return { bg: 'bg-blue-500/20',    text: 'text-blue-300',    ring: 'ring-blue-500/40'    };
  if (score >= 6) return { bg: 'bg-white/8',         text: 'text-gray-300',   ring: 'ring-white/10'       };
  return                   { bg: 'bg-gray-800/60',    text: 'text-gray-500',   ring: 'ring-white/5'        };
}

export function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Pitch view ───────────────────────────────────────────────────────────────

export const GROUP_COLORS: Record<PositionGroup, { ring: string; dot: string; badge: string }> = {
  GK:  { ring: 'ring-yellow-400',  dot: 'bg-yellow-400',  badge: 'bg-yellow-500/75'  },
  DEF: { ring: 'ring-sky-400',     dot: 'bg-sky-400',     badge: 'bg-sky-600/75'     },
  MID: { ring: 'ring-emerald-400', dot: 'bg-emerald-400', badge: 'bg-emerald-600/75' },
  FWD: { ring: 'ring-orange-400',  dot: 'bg-orange-400',  badge: 'bg-orange-500/75'  },
};
