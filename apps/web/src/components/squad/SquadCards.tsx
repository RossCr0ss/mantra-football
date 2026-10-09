'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import type { FotMobPlayer, PlayerInjuryInfo } from '@/lib/fotmob';
import { isReturningToday } from '@/lib/injuryDate';
import type { SquadPlayer } from '@/types/squad';

export function SquadListItem({ player, onRemove }: { player: SquadPlayer; onRemove: () => void }) {
  const [injury, setInjury] = useState<PlayerInjuryInfo | null>(null);

  useEffect(() => {
    if (!player.injured) return;
    fetch(`/api/players/${player.id}/injury`)
      .then((r) => r.json())
      .then((d) => setInjury(d.injury ?? null))
      .catch(() => null);
  }, [player.id, player.injured]);

  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
      player.injured ? 'border-red-500/20 bg-red-950/10' : 'border-white/8 bg-gray-900'
    }`}>
      <div className="relative mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-gray-700">
        <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white">{player.name}</p>
        <div className="flex items-center gap-1">
          <div className="relative h-3.5 w-3.5 shrink-0">
            <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`} alt="" fill className="object-contain" unoptimized />
          </div>
          <p className="text-xs text-gray-600">{player.positionGroup} · {player.teamName}</p>
        </div>
        {player.injured && (
          <p className="mt-0.5 text-xs font-semibold text-red-400">
            {injury ? injury.name : 'Injured'}
            {injury && isReturningToday(injury) ? (
              <span className="ml-1 font-semibold text-green-400">· Returns today!</span>
            ) : injury?.expectedReturn ? (
              <span className="ml-1 font-normal text-red-300/60">· {injury.expectedReturn}</span>
            ) : null}
          </p>
        )}
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove player"
        className="mt-0.5 shrink-0 text-gray-700 transition hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Player card ──────────────────────────────────────────────────────────────

export function CatalogPlayerCard({
  player,
  inSquad,
  onAdd,
}: {
  player: FotMobPlayer;
  inSquad: boolean;
  onAdd: () => void;
}) {
  const [injury, setInjury] = useState<PlayerInjuryInfo | null>(null);

  useEffect(() => {
    if (!player.injured) return;
    fetch(`/api/players/${player.id}/injury`)
      .then((r) => r.json())
      .then((d) => setInjury(d.injury ?? null))
      .catch(() => null);
  }, [player.id, player.injured]);

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border transition ${
      inSquad
        ? 'border-green-700/40 bg-green-950/20'
        : 'border-white/8 bg-gray-900 hover:border-white/20'
    }`}>
      {/* Portrait image */}
      <div className="relative h-32 w-full bg-gray-800">
        <Image src={player.imageUrl} alt={player.name} fill className="object-contain" unoptimized />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
        {player.injured && (
          <div className="absolute left-1.5 top-1.5 rounded bg-red-600/80 px-1 py-0.5 text-[9px] font-bold text-white">INJ</div>
        )}
        {inSquad && (
          <div className="absolute right-1.5 top-1.5 rounded-full bg-green-600/80 px-1.5 py-0.5 text-[9px] font-bold text-white">✓</div>
        )}
      </div>

      {/* Info + add */}
      <div className="flex flex-col gap-2 p-3 text-center">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">{player.name}</p>
          <p className="text-xs text-gray-600">
            {player.shirtNumber != null ? `#${player.shirtNumber} · ` : ''}{player.positionLabel}
          </p>
          {player.injured && (
            <div className="mt-1.5 rounded-lg border border-red-500/20 bg-red-950/30 px-2 py-1">
              <p className="text-xs font-semibold text-red-400">
                {injury ? injury.name : 'Injured'}
              </p>
              {injury && isReturningToday(injury) ? (
                <p className="text-xs font-semibold text-green-400">Returns today!</p>
              ) : injury?.expectedReturn ? (
                <p className="text-xs text-red-300/60">Return: {injury.expectedReturn}</p>
              ) : null}
            </div>
          )}
        </div>
        <button
          onClick={onAdd}
          disabled={inSquad}
          className={`w-full rounded-lg py-1.5 text-xs font-semibold transition ${
            inSquad
              ? 'bg-green-900/50 text-green-400'
              : 'bg-white/8 text-white hover:bg-white/15'
          }`}
        >
          {inSquad ? '✓ Added' : '+ Add'}
        </button>
      </div>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────
