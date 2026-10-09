'use client';

import Image from 'next/image';
import type { PositionGroup } from '@/types/squad';
import { effectivePositionGroup } from '@/lib/positionGroups';
import { MODULES, effectiveScore, type EnrichedPlayer } from '@/lib/tourModules';
import { GROUP_COLORS, scoreTier } from '@/components/tour/tourUi';

export const GK_COORD: [number, number] = [50, 138];

/**
 * Explicit [x, y] pitch coordinates per outfield slot (indices 0–9, matching
 * each formation's `slots` array in MODULES).  ViewBox 100 × 154.
 * Attacking direction: top (y ≈ 0).  Defending end: bottom (y ≈ 154).
 */
export const MODULE_SLOT_COORDS: Record<string, Array<[number, number]>> = {
  '3-4-3':   [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[12,35],[50,30],[88,35]],
  '3-4-1-2': [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[50,52],[35,28],[65,28]],
  '3-4-2-1': [[22,112],[50,115],[78,112],[10,80],[32,78],[68,78],[90,80],[32,52],[68,52],[50,28]],
  '3-5-2':   [[22,112],[50,115],[78,112],[10,78],[27,78],[50,78],[73,78],[90,78],[35,30],[65,30]],
  '3-5-1-1': [[22,112],[50,115],[78,112],[35,88],[65,88],[50,70],[10,70],[50,48],[90,70],[50,28]],
  '4-3-3':   [[82,112],[60,115],[40,115],[18,112],[25,80],[50,78],[75,80],[12,35],[50,30],[88,35]],
  '4-3-1-2': [[82,112],[60,115],[40,115],[18,112],[25,82],[50,80],[75,82],[50,58],[35,30],[65,30]],
  '4-4-2':   [[82,112],[60,115],[40,115],[18,112],[12,80],[35,78],[65,78],[88,80],[35,32],[65,32]],
  '4-1-4-1': [[82,112],[60,115],[40,115],[18,112],[50,90],[12,70],[35,68],[65,68],[88,70],[50,28]],
  '4-4-1-1': [[82,112],[60,115],[40,115],[18,112],[12,80],[35,78],[65,78],[88,80],[50,55],[50,28]],
  '4-2-3-1': [[82,112],[60,115],[40,115],[18,112],[38,88],[62,88],[15,60],[50,58],[85,60],[50,28]],
  '4-3-2-1': [[82,112],[60,115],[40,115],[18,112],[25,82],[50,80],[75,82],[30,55],[70,55],[50,28]],
};

/** Groups of outfield slot indices on the same formation line (for polyline connectors). */
export function getFormationLines(moduleName: string): number[][] {
  const coords = MODULE_SLOT_COORDS[moduleName];
  if (!coords) return [];
  const Y_TOLERANCE = 14;
  const groups: number[][] = [];
  const assigned = new Set<number>();
  for (let i = 0; i < coords.length; i++) {
    if (assigned.has(i)) continue;
    const yi = coords[i][1];
    const group: number[] = [i];
    assigned.add(i);
    for (let j = i + 1; j < coords.length; j++) {
      if (!assigned.has(j) && Math.abs(coords[j][1] - yi) <= Y_TOLERANCE) {
        group.push(j);
        assigned.add(j);
      }
    }
    if (group.length > 1) {
      group.sort((a, b) => coords[a][0] - coords[b][0]);
      groups.push(group);
    }
  }
  return groups;
}

export function PitchView({
  slottedPlayers,
  moduleName,
  slotsPenalty,
  onRemove,
}: {
  slottedPlayers: EnrichedPlayer[];
  moduleName: string;
  slotsPenalty: number[];
  onRemove: (id: number) => void;
}) {
  const outfieldCoords = MODULE_SLOT_COORDS[moduleName] ?? [];
  const formationLines = getFormationLines(moduleName);
  const moduleDef = MODULES.find((m) => m.name === moduleName);

  return (
    <div className="mx-auto w-full max-w-sm sm:max-w-xl md:max-w-2xl">
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ paddingBottom: '154%' }}>

        {/* ── Pitch SVG ──────────────────────────────────────────────────── */}
        <svg viewBox="0 0 100 154" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="pv-grass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#1a6129" />
              <stop offset="50%"  stopColor="#1e7030" />
              <stop offset="100%" stopColor="#1a6129" />
            </linearGradient>
            <pattern id="pv-stripes" x="0" y="0" width="100" height="14" patternUnits="userSpaceOnUse">
              <rect x="0" y="0" width="100" height="7" fill="rgba(255,255,255,0.025)" />
            </pattern>
          </defs>

          {/* Field fill */}
          <rect x="0" y="0" width="100" height="154" fill="url(#pv-grass)" />
          <rect x="0" y="0" width="100" height="154" fill="url(#pv-stripes)" />

          {/* Pitch outline */}
          <rect x="2" y="2" width="96" height="150" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.5" />

          {/* Corner arcs */}
          <path d="M 2 9 A 7 7 0 0 0 9 2"       fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 93 2 A 7 7 0 0 1 98 9"     fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 2 145 A 7 7 0 0 1 9 152"   fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />
          <path d="M 93 152 A 7 7 0 0 0 98 145" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.4" />

          {/* Centre line + circle + spot */}
          <line x1="2" y1="77" x2="98" y2="77" stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />
          <circle cx="50" cy="77" r="10"  fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.4" />
          <circle cx="50" cy="77" r="0.8" fill="rgba(255,255,255,0.5)" />

          {/* Opponent end (top) */}
          <rect x="24" y="2" width="52" height="22" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
          <rect x="37" y="2" width="26" height="8"  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.35" />
          <circle cx="50" cy="18" r="0.7" fill="rgba(255,255,255,0.35)" />
          <path d="M 43 24 A 10 10 0 0 1 57 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />
          <rect x="41" y="0.5" width="18" height="2" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />

          {/* Our end (bottom) */}
          <rect x="24" y="130" width="52" height="22" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" />
          <rect x="37" y="144" width="26" height="8"  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.35" />
          <circle cx="50" cy="136" r="0.7" fill="rgba(255,255,255,0.35)" />
          <path d="M 43 130 A 10 10 0 0 0 57 130" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />
          <rect x="41" y="151.5" width="18" height="2" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />

          {/* Formation connecting lines */}
          {formationLines.map((group, gi) => (
            <polyline
              key={gi}
              points={group.map((si) => `${outfieldCoords[si][0]},${outfieldCoords[si][1]}`).join(' ')}
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="0.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 1.5"
            />
          ))}
        </svg>

        {/* ── Player tokens ──────────────────────────────────────────────── */}
        {slottedPlayers.map((player, slotIdx) => {
          const isGK = slotIdx === 0;
          const [cx, cy] = isGK ? GK_COORD : (outfieldCoords[slotIdx - 1] ?? [50, 77] as [number, number]);
          const pen        = slotsPenalty[slotIdx] ?? 0;
          const display    = effectiveScore(player.scoreBreakdown, pen);
          const tier       = scoreTier(display);
          const colors     = GROUP_COLORS[effectivePositionGroup(player)];
          const slotDef    = isGK ? ['GK'] : (moduleDef?.slots[slotIdx - 1] ?? []);
          const roleLabel  = slotDef[0] ?? '';

          return (
            <button
              key={player.id}
              onClick={() => onRemove(player.id)}
              title={`${player.name}${pen < 0 ? ` (out of position: ${pen})` : ''} — click to remove`}
              className="group absolute flex flex-col items-center"
              style={{ left: `${cx}%`, top: `${(cy / 154) * 100}%`, transform: 'translate(-50%, -50%)' }}
            >
              {/* Score chip — shows penalized score when out of position */}
              <span className={`mb-0.5 rounded px-1 text-[9px] font-bold tabular-nums leading-4 ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}>
                {display.toFixed(1)}
              </span>

              {/* Avatar + team logo badge + hover overlay */}
              <div className="relative">
                <div className={`relative overflow-hidden rounded-full ring-2 transition-all group-hover:ring-red-400 ${isGK ? 'h-12 w-12' : 'h-11 w-11'} ${colors.ring}`}>
                  <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
                  <div className="absolute inset-0 flex items-center justify-center bg-red-600/0 transition-all group-hover:bg-red-600/80">
                    <span className="text-xs font-bold text-transparent transition-all group-hover:text-white">✕</span>
                  </div>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] overflow-hidden rounded-full bg-gray-900 ring-1 ring-black/50">
                  <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain p-px" unoptimized />
                </div>
              </div>

              {/* Name pill */}
              <div className="mt-0.5 max-w-[80px] rounded bg-black/70 px-1">
                <p className="truncate text-center text-[9px] font-semibold leading-4 text-white">
                  {player.name.split(' ').pop()}
                </p>
              </div>

              {/* Slot role badge + out-of-position penalty */}
              <div className="flex items-center gap-0.5">
                {roleLabel && (
                  <span className={`rounded px-0.5 text-[8px] font-bold leading-3 text-white ${colors.badge}`}>
                    {roleLabel}
                  </span>
                )}
                {pen < 0 && (
                  <span className={`rounded px-0.5 text-[8px] font-bold leading-3 ${pen <= -3 ? 'bg-orange-600/80 text-orange-100' : 'bg-yellow-600/80 text-yellow-100'}`}>
                    {pen}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {(Object.keys(GROUP_COLORS) as PositionGroup[]).map((g) => (
          <span key={g} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className={`inline-block h-2 w-2 rounded-full ${GROUP_COLORS[g].dot}`} />
            {g}
          </span>
        ))}
        <span className="ml-2 text-xs font-semibold text-gray-400">{moduleName}</span>
      </div>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────
