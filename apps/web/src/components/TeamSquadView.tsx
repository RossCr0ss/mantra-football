'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { SquadPlayer, MantraPosition, PositionGroup, LineupStatus } from '@/types/squad';
import type { PlayerInjuryInfo } from '@/lib/fotmob';
import {
  MANTRA_POSITIONS,
  MANTRA_POSITION_COLOR,
  type MantraPositionDef,
} from '@/lib/mantraPositions';

function pctAccentColor(pct: number): string {
  if (pct === 100) return '#4ade80';
  if (pct >= 75)   return '#86efac';
  if (pct >= 50)   return '#60a5fa';
  if (pct >= 25)   return '#fbbf24';
  if (pct > 0)     return '#fb923c';
  return '#6b7280';
}

function pctTextClass(pct: number): string {
  if (pct === 100) return 'text-green-400';
  if (pct >= 75)   return 'text-green-300';
  if (pct >= 50)   return 'text-blue-400';
  if (pct >= 25)   return 'text-yellow-400';
  if (pct > 0)     return 'text-orange-400';
  return 'text-gray-500';
}

const POSITION_SECTIONS: { group: PositionGroup; label: string }[] = [
  { group: 'GK',  label: 'Goalkeepers' },
  { group: 'DEF', label: 'Defenders'   },
  { group: 'MID', label: 'Midfielders' },
  { group: 'FWD', label: 'Forwards'    },
];

const MANTRA_POSITION_ORDER = Object.fromEntries(MANTRA_POSITIONS.map((p, i) => [p.code, i]));

function effectiveGroup(player: SquadPlayer): PositionGroup {
  if (player.mantraPositions.length > 0) {
    const def = MANTRA_POSITIONS.find((d) => d.code === player.mantraPositions[0]);
    if (def) return def.group;
  }
  return player.positionGroup;
}

const POSITIONS_BY_GROUP = MANTRA_POSITIONS.reduce<Partial<Record<PositionGroup, MantraPositionDef[]>>>(
  (acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  },
  {},
);

function isToday(info: PlayerInjuryInfo): boolean {
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


interface Props {
  leagueId: number;
  initialPlayers: SquadPlayer[];
  injuries: Record<number, PlayerInjuryInfo>;
  primaryColor: string;
}

export default function TeamSquadView({ leagueId, initialPlayers, injuries: initialInjuries, primaryColor }: Props) {
  const [players, setPlayers] = useState(initialPlayers);
  const [injuries, setInjuries] = useState<Record<number, PlayerInjuryInfo>>(initialInjuries);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingInjuryId, setEditingInjuryId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', expectedReturnDate: '' });
  const [savingInjury, setSavingInjury] = useState(false);
  /** playerId currently undergoing a clear/reset network action */
  const [injuryActionId, setInjuryActionId] = useState<number | null>(null);

  async function toggleLineupStatus(playerId: number, status: LineupStatus) {
    const player = players.find((p) => p.id === playerId);
    const newStatus = player?.lineupStatus === status ? null : status;
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, lineupStatus: newStatus ?? undefined } : p)),
    );
    await fetch('/api/squad', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId, lineupStatus: newStatus }),
    });
  }

  async function setAvailabilityPct(playerId: number, pct: number) {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, availabilityPct: pct } : p)),
    );
    await fetch('/api/squad', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId, availabilityPct: pct }),
    });
  }

  async function togglePosition(playerId: number, pos: MantraPosition) {
    const updated = players.map((p) => {
      if (p.id !== playerId) return p;
      const has = p.mantraPositions.includes(pos);
      return {
        ...p,
        mantraPositions: has
          ? p.mantraPositions.filter((x) => x !== pos)
          : [...p.mantraPositions, pos],
      };
    });
    setPlayers(updated);

    const player = updated.find((p) => p.id === playerId)!;
    await fetch('/api/squad', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId, mantraPositions: player.mantraPositions }),
    });
  }

  function startEditInjury(player: SquadPlayer) {
    const info = injuries[player.id];
    setEditForm({
      name: info?.name ?? '',
      expectedReturnDate: info?.expectedReturnDate ?? '',
    });
    setEditingInjuryId(player.id);
  }

  async function saveInjury(playerId: number) {
    setSavingInjury(true);
    try {
      const res = await fetch(`/api/players/${playerId}/injury`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          expectedReturn: editForm.expectedReturnDate || null,
          expectedReturnDate: editForm.expectedReturnDate || null,
        }),
      });
      const data = await res.json();
      if (data.injury) {
        setInjuries((prev) => ({ ...prev, [playerId]: data.injury }));
      }
      setEditingInjuryId(null);
    } finally {
      setSavingInjury(false);
    }
  }

  /** Mark player as healed — stores cleared=true in DB, suppresses FotMob data */
  async function clearInjury(playerId: number) {
    setInjuryActionId(playerId);
    try {
      await fetch(`/api/players/${playerId}/injury`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleared: true }),
      });
      setInjuries((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
      setEditingInjuryId(null);
    } finally {
      setInjuryActionId(null);
    }
  }

  /** Delete the manual override so live data flows again. */
  async function resetToFotmob(playerId: number) {
    setInjuryActionId(playerId);
    try {
      const res = await fetch(`/api/players/${playerId}/injury`, { method: 'DELETE' });
      const data = await res.json();
      setInjuries((prev) => {
        const next = { ...prev };
        if (data.injury) {
          next[playerId] = data.injury;
        } else {
          delete next[playerId];
        }
        return next;
      });
      setEditingInjuryId(null);
    } finally {
      setInjuryActionId(null);
    }
  }

  const [refreshingInjuries, setRefreshingInjuries] = useState(false);

  async function refreshInjuries() {
    setRefreshingInjuries(true);
    try {
      const results = await Promise.all(
        players.map((p) =>
          fetch(`/api/players/${p.id}/injury`)
            .then((r) => r.json())
            .then((d) => ({ id: p.id, injury: d.injury as (typeof injuries)[number] | null }))
            .catch(() => ({ id: p.id, injury: null })),
        ),
      );
      const updated: Record<number, typeof injuries[number]> = {};
      for (const { id, injury } of results) {
        if (injury) updated[id] = injury;
      }
      setInjuries(updated);
    } finally {
      setRefreshingInjuries(false);
    }
  }

  const injuredPlayers = players.filter((p) => injuries[p.id] != null);

  return (
    <div className="space-y-10">
      {/* ── Injury report ── */}
      {injuredPlayers.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-red-950 px-2.5 py-1 text-xs font-bold tracking-widest text-red-400">
                INJURIES
              </span>
              <h2 className="text-sm font-semibold text-white">Injury Report</h2>
              <span className="text-xs text-gray-600">({injuredPlayers.length})</span>
            </div>
            <button
              onClick={refreshInjuries}
              disabled={refreshingInjuries}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {refreshingInjuries ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="divide-y divide-red-500/10 overflow-hidden rounded-2xl border border-red-500/15">
            {injuredPlayers.map((player) => {
              const info = injuries[player.id];
              const returning = info ? isToday(info) : false;
              const isEditingThis = editingInjuryId === player.id;

              return (
                <div key={player.id} className="bg-red-950/15 px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-4">
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-800">
                      <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">{player.name}</p>
                      <p className="text-xs text-gray-500">{player.position} · {player.teamName}</p>
                    </div>

                    <div className="shrink-0 text-right">
                      {info ? (
                        <>
                          <div className="flex items-center justify-end gap-1.5">
                            <p className="text-sm font-semibold text-red-400">{info.name}</p>
                            {info.overridden && (
                              <span className="rounded bg-yellow-900/50 px-1.5 py-0.5 text-xs text-yellow-400">
                                custom
                              </span>
                            )}
                          </div>
                          {returning ? (
                            <p className="mt-0.5 text-xs font-semibold text-green-400">Returns today!</p>
                          ) : info.expectedReturn ? (
                            <p className="text-xs text-gray-500">Return: {info.expectedReturn}</p>
                          ) : (
                            <p className="text-xs text-gray-600">Date unknown</p>
                          )}
                          {info.lastUpdated && (
                            <p className="text-xs text-gray-700">
                              {new Date(info.lastUpdated).toLocaleDateString('en-GB', {
                                day: 'numeric', month: 'short', year: 'numeric',
                              })}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-red-400">Injured</p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-1.5">
                      {/* Quick clear — always visible */}
                      {!isEditingThis && (
                        <button
                          onClick={() => clearInjury(player.id)}
                          disabled={injuryActionId === player.id}
                          className="rounded-lg bg-green-900/40 px-2.5 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                        >
                          {injuryActionId === player.id ? '…' : 'Healed'}
                        </button>
                      )}
                      <button
                        onClick={() => isEditingThis ? setEditingInjuryId(null) : startEditInjury(player)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                          isEditingThis
                            ? 'bg-white/15 text-white'
                            : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {isEditingThis ? 'Cancel' : 'Edit'}
                      </button>
                    </div>
                  </div>

                  {isEditingThis && (
                    <div className="mt-3 rounded-xl border border-white/8 bg-gray-950 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold text-gray-400">Injury name</span>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="e.g. Muscle Strain"
                            className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 transition focus:border-white/25 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold text-gray-400">Expected return</span>
                          <input
                            type="date"
                            value={editForm.expectedReturnDate}
                            onChange={(e) => setEditForm((f) => ({ ...f, expectedReturnDate: e.target.value }))}
                            className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white transition focus:border-white/25 focus:outline-none [color-scheme:dark]"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {/* Left side: destructive actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => clearInjury(player.id)}
                            disabled={injuryActionId === player.id}
                            className="rounded-lg bg-green-900/40 px-3 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                          >
                            {injuryActionId === player.id ? '…' : 'Mark as healed'}
                          </button>
                          {info?.overridden && (
                            <button
                              onClick={() => resetToFotmob(player.id)}
                              disabled={injuryActionId === player.id}
                              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                            >
                              {injuryActionId === player.id ? '…' : 'Use live data'}
                            </button>
                          )}
                        </div>
                        {/* Right: save */}
                        <button
                          onClick={() => saveInjury(player.id)}
                          disabled={savingInjury || !editForm.name.trim()}
                          className="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-40"
                        >
                          {savingInjury ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Players by position group ── */}
      {POSITION_SECTIONS.map(({ group, label }) => {
        const groupPlayers = players
          .filter((p) => effectiveGroup(p) === group)
          .sort((a, b) => {
            const aOrder = a.mantraPositions[0] != null ? (MANTRA_POSITION_ORDER[a.mantraPositions[0]] ?? 99) : 99;
            const bOrder = b.mantraPositions[0] != null ? (MANTRA_POSITION_ORDER[b.mantraPositions[0]] ?? 99) : 99;
            return aOrder - bOrder;
          });
        if (groupPlayers.length === 0) return null;

        return (
          <section key={group}>
            <SectionHeader
              badge={group}
              badgeStyle={{ backgroundColor: primaryColor }}
              title={label}
              count={groupPlayers.length}
            />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {groupPlayers.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  injury={injuries[player.id]}
                  isEditing={editingId === player.id}
                  onEditToggle={() => setEditingId((id) => (id === player.id ? null : player.id))}
                  onTogglePosition={(pos) => togglePosition(player.id, pos)}
                  onToggleStatus={(s) => toggleLineupStatus(player.id, s)}
                  onSetAvailability={(pct) => setAvailabilityPct(player.id, pct)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  badge,
  badgeClass,
  badgeStyle,
  title,
  count,
}: {
  badge: string;
  badgeClass?: string;
  badgeStyle?: React.CSSProperties;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className={`rounded-lg px-2.5 py-1 text-xs font-bold tracking-widest text-white ${badgeClass ?? ''}`}
        style={badgeStyle}
      >
        {badge}
      </span>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <span className="text-xs text-gray-600">({count})</span>
    </div>
  );
}

// ─── Player card ───────────────────────────────────────────────────────────────

function PlayerCard({
  player,
  injury,
  isEditing,
  onEditToggle,
  onTogglePosition,
  onToggleStatus,
  onSetAvailability,
}: {
  player: SquadPlayer;
  injury?: PlayerInjuryInfo;
  isEditing: boolean;
  onEditToggle: () => void;
  onTogglePosition: (pos: MantraPosition) => void;
  onToggleStatus: (s: LineupStatus) => void;
  onSetAvailability: (pct: number) => void;
}) {
  const [localPct, setLocalPct] = useState<number | null>(null);
  const returning = injury ? isToday(injury) : false;
  const isBlocked = player.lineupStatus === 'injured' || player.lineupStatus === 'suspended';
  const displayPct = localPct ?? (player.availabilityPct ?? 100);

  const cardBorderClass =
    player.lineupStatus === 'suspended' ? 'border-orange-500/20 bg-orange-950/8' :
    player.lineupStatus === 'injured'   ? 'border-red-500/20 bg-red-950/8'       :
                                          'border-white/8 bg-gray-900';

  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border p-3 transition ${cardBorderClass}`}>
      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="relative h-14 w-14 overflow-hidden rounded-full bg-gray-800 ring-2 ring-white/5">
          <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
        </div>
        <div className="w-full min-w-0">
          <p className="truncate text-xs font-semibold leading-tight text-white">{player.name}</p>
          <p className="truncate text-xs text-gray-600">{player.teamName}</p>
        </div>
      </div>

      {/* Mantra positions */}
      <div className="flex flex-wrap justify-center gap-1">
        {player.mantraPositions.length === 0 ? (
          <span className="text-xs text-gray-700">No position</span>
        ) : (
          player.mantraPositions.map((pos) => {
            const def = MANTRA_POSITIONS.find((p) => p.code === pos)!;
            return (
              <span
                key={pos}
                className={`rounded border px-1.5 py-0.5 text-xs font-bold ${MANTRA_POSITION_COLOR[def.group]}`}
              >
                {pos}
              </span>
            );
          })
        )}
      </div>

      {/* Injury badge */}
      {injury && (
        <div className="rounded-lg border border-red-500/20 bg-red-950/40 px-2 py-1 text-center">
          <p className="text-xs font-semibold text-red-400">{injury.name ?? 'Injured'}</p>
          {returning ? (
            <p className="text-xs font-semibold text-green-400">Returns today!</p>
          ) : injury.expectedReturn ? (
            <p className="text-xs text-red-300/60">{injury.expectedReturn}</p>
          ) : null}
        </div>
      )}

      {/* Status controls */}
      <div className="space-y-0.5 rounded-lg bg-gray-950/80 p-0.5">
        {/* Injury / Suspension toggles */}
        <div className="grid grid-cols-2 gap-0.5">
          {(['injured', 'suspended'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onToggleStatus(s)}
              className={`rounded px-1 py-1 text-xs font-semibold transition border ${
                player.lineupStatus === s
                  ? s === 'injured'
                    ? 'bg-red-900/80 text-red-300 border-red-600/40'
                    : 'bg-orange-900/80 text-orange-300 border-orange-600/40'
                  : 'border-transparent text-gray-600 hover:text-gray-300'
              }`}
            >
              {s === 'injured' ? 'Injured' : 'Susp.'}
            </button>
          ))}
        </div>

        {/* Availability slider — only when not injured/suspended */}
        {!isBlocked && (
          <div className="px-1 pt-1 pb-0.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-600">Start %</span>
              <span className={`text-xs font-bold tabular-nums ${pctTextClass(displayPct)}`}>
                {displayPct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={displayPct}
              onChange={(e) => setLocalPct(Number(e.target.value))}
              onPointerUp={(e) => {
                const val = Number((e.currentTarget as HTMLInputElement).value);
                setLocalPct(null);
                onSetAvailability(val);
              }}
              className="w-full h-1 rounded-full cursor-pointer appearance-none bg-gray-700
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-white
                [&::-moz-range-thumb]:h-3
                [&::-moz-range-thumb]:w-3
                [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-white
                [&::-moz-range-thumb]:border-0"
              style={{
                background: `linear-gradient(to right, ${pctAccentColor(displayPct)} ${displayPct}%, rgb(55,65,81) ${displayPct}%)`,
              }}
            />
          </div>
        )}
      </div>

      {/* Edit positions toggle */}
      <button
        onClick={onEditToggle}
        className={`w-full rounded-lg py-1.5 text-xs font-semibold transition ${
          isEditing
            ? 'bg-white/15 text-white'
            : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
        }`}
      >
        {isEditing ? 'Done' : 'Edit positions'}
      </button>

      {/* Inline position editor */}
      {isEditing && (
        <div className="space-y-2 rounded-xl border border-white/8 bg-gray-950 p-2">
          {Object.entries(POSITIONS_BY_GROUP).map(([grp, defs]) => (
            <div key={grp}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600">{grp}</p>
              <div className="flex flex-wrap gap-1">
                {defs!.map((def) => {
                  const active = player.mantraPositions.includes(def.code);
                  return (
                    <button
                      key={def.code}
                      onClick={() => onTogglePosition(def.code)}
                      title={`${def.label} (${def.italian})`}
                      className={`rounded border px-1.5 py-0.5 text-xs font-bold transition ${
                        active
                          ? MANTRA_POSITION_COLOR[def.group]
                          : 'border-white/8 text-gray-600 hover:text-gray-300'
                      }`}
                    >
                      {def.code}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
