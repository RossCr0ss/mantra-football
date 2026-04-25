import type { MantraPosition, PositionGroup } from '@/types/squad';

export interface MantraPositionDef {
  code: MantraPosition;
  label: string;
  italian: string;
  group: PositionGroup;
}

export const MANTRA_POSITIONS: MantraPositionDef[] = [
  { code: 'GK', label: 'Goalkeeper',        italian: 'Por', group: 'GK'  },
  { code: 'RB', label: 'Right Back',         italian: 'Dd',  group: 'DEF' },
  { code: 'CB', label: 'Centre Back',        italian: 'Dc',  group: 'DEF' },
  { code: 'LB', label: 'Left Back',          italian: 'Ds',  group: 'DEF' },
  { code: 'WB', label: 'Wing Back',          italian: 'E',   group: 'DEF' },
  { code: 'DM', label: 'Def. Midfielder',    italian: 'M',   group: 'MID' },
  { code: 'CM', label: 'Central Mid.',       italian: 'C',   group: 'MID' },
  { code: 'W',  label: 'Winger',             italian: 'W',   group: 'MID' },
  { code: 'AM', label: 'Att. Midfielder',    italian: 'T',   group: 'MID' },
  { code: 'FW', label: 'Wing Forward',       italian: 'A',   group: 'FWD' },
  { code: 'ST', label: 'Striker',            italian: 'Pc',  group: 'FWD' },
];

export const MANTRA_POSITION_COLOR: Record<PositionGroup, string> = {
  GK:  'bg-amber-900/60 text-amber-300 border-amber-500/30',
  DEF: 'bg-green-900/60 text-green-300 border-green-500/30',
  MID: 'bg-blue-900/60  text-blue-300  border-blue-500/30',
  FWD: 'bg-red-900/60   text-red-300   border-red-500/30',
};

/** Best-effort mapping from a FotMob positionLabel + positionGroup to Mantra positions. */
export function guessMantraPositions(
  fotmobLabel: string,
  group: PositionGroup,
): MantraPosition[] {
  const l = fotmobLabel.toLowerCase();

  if (group === 'GK') return ['GK'];

  if (group === 'DEF') {
    if (l.includes('right wing') || l === 'rwb') return ['RB', 'WB'];
    if (l.includes('left wing') || l === 'lwb')  return ['LB', 'WB'];
    if (l.includes('wing') || l === 'wb' || l === 'e') return ['WB'];
    if (l.includes('right') || l === 'rb' || l === 'dd') return ['RB'];
    if (l.includes('left')  || l === 'lb' || l === 'ds') return ['LB'];
    return ['CB'];
  }

  if (group === 'MID') {
    if (l.includes('defensive') || l === 'dm' || l === 'cdm' || l === 'm') return ['DM'];
    if (l.includes('attacking') || l === 'am' || l === 'cam' || l === 't') return ['AM'];
    if (l.includes('right wing') || l.includes('left wing') || l === 'lw' || l === 'rw') return ['W'];
    if (l.includes('wing') || l === 'w') return ['W'];
    return ['CM'];
  }

  // FWD
  if (l.includes('second') || l.includes('shadow') || l === 'ss' || l === 'a') return ['FW'];
  return ['ST'];
}
