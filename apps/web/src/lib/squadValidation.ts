import { SQUAD_RULES, type SquadPlayer, type MantraPosition, type PositionGroup } from '@/types/squad';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';

const GROUPS = new Set<PositionGroup>(['GK', 'DEF', 'MID', 'FWD']);
const POSITIONS = new Set<string>(MANTRA_POSITIONS.map((p) => p.code));

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

/** Whitelists known fields (drops anything else, e.g. `$`-prefixed keys) and validates types. Null = invalid. */
export function sanitizeSquadPlayer(raw: unknown): SquadPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (!isInt(r.id) || !isStr(r.name) || !r.name || !isInt(r.teamId) || !isStr(r.teamName)) return null;
  if (!isStr(r.position, 50) || !GROUPS.has(r.positionGroup as PositionGroup) || !isStr(r.imageUrl, 500)) return null;
  if (!Array.isArray(r.mantraPositions) || r.mantraPositions.some((m) => !POSITIONS.has(m as string))) return null;

  const p: SquadPlayer = {
    id: r.id,
    name: r.name,
    teamId: r.teamId,
    teamName: r.teamName,
    position: r.position,
    positionGroup: r.positionGroup as PositionGroup,
    imageUrl: r.imageUrl,
    mantraPositions: r.mantraPositions as MantraPosition[],
  };

  if (r.injured !== undefined) {
    if (typeof r.injured !== 'boolean') return null;
    p.injured = r.injured;
  }
  if (r.lineupStatus !== undefined && r.lineupStatus !== null) {
    if (r.lineupStatus !== 'injured' && r.lineupStatus !== 'suspended') return null;
    p.lineupStatus = r.lineupStatus;
  }
  if (r.lineupStatusSource !== undefined) {
    if (r.lineupStatusSource !== 'manual' && r.lineupStatusSource !== 'auto') return null;
    p.lineupStatusSource = r.lineupStatusSource;
  }
  if (r.availabilityPct !== undefined) {
    if (typeof r.availabilityPct !== 'number' || !(r.availabilityPct >= 0 && r.availabilityPct <= 100)) return null;
    p.availabilityPct = r.availabilityPct;
  }
  if (r.availabilityPctSource !== undefined) {
    if (r.availabilityPctSource !== 'manual' && r.availabilityPctSource !== 'suggested') return null;
    p.availabilityPctSource = r.availabilityPctSource;
  }
  return p;
}

/** Validates a full squad payload against SQUAD_RULES. Returns sanitized players or an error message. */
export function validateSquadPayload(raw: unknown): { players: SquadPlayer[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'players must be an array' };
  if (raw.length !== SQUAD_RULES.total) return { error: `Squad must have exactly ${SQUAD_RULES.total} players` };

  const players: SquadPlayer[] = [];
  for (const item of raw) {
    const p = sanitizeSquadPlayer(item);
    if (!p) return { error: 'Invalid player in squad' };
    players.push(p);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) return { error: 'Duplicate players in squad' };
  const gk = players.filter((p) => p.positionGroup === 'GK').length;
  if (gk !== SQUAD_RULES.goalkeepers) return { error: `Squad must have exactly ${SQUAD_RULES.goalkeepers} goalkeepers` };
  return { players };
}
