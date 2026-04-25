'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { SquadPlayer, LineupStatus } from '@/types/squad';
import type { PlayerInjuryInfo } from '@/lib/fotmob';

interface Props {
  leagueId: number;
  initialPlayers: SquadPlayer[];
  initialInjuries: Record<number, PlayerInjuryInfo>;
}

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

export default function InjuryReportView({ leagueId, initialPlayers, initialInjuries }: Props) {
  const [players, setPlayers] = useState<SquadPlayer[]>(initialPlayers);
  const [injuries, setInjuries] = useState<Record<number, PlayerInjuryInfo>>(initialInjuries);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  // ── Categories ───────────────────────────────────────────────────────────────
  const injuredPlayers   = players.filter((p) => injuries[p.id] != null || p.lineupStatus === 'injured');
  const suspendedPlayers = players.filter((p) => p.lineupStatus === 'suspended');
  const doubtfulPlayers  = players.filter(
    (p) =>
      p.lineupStatus !== 'injured' &&
      p.lineupStatus !== 'suspended' &&
      (p.availabilityPct ?? 100) < 100,
  );
  const totalConcerns = injuredPlayers.length + suspendedPlayers.length + doubtfulPlayers.length;

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function refreshAll() {
    setRefreshing(true);
    try {
      const results = await Promise.all(
        players.map((p) =>
          fetch(`/api/players/${p.id}/injury`)
            .then((r) => r.json())
            .then((d) => ({ id: p.id, injury: d.injury as PlayerInjuryInfo | null }))
            .catch(() => ({ id: p.id, injury: null })),
        ),
      );
      const updated: Record<number, PlayerInjuryInfo> = {};
      for (const { id, injury } of results) {
        if (injury) updated[id] = injury;
      }
      setInjuries(updated);
    } finally {
      setRefreshing(false);
    }
  }

  async function clearInjury(playerId: number) {
    setActionId(playerId);
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
      setPlayers((prev) =>
        prev.map((p) => (p.id === playerId && p.lineupStatus === 'injured' ? { ...p, lineupStatus: undefined } : p)),
      );
    } finally {
      setActionId(null);
    }
  }

  async function clearStatus(playerId: number) {
    setActionId(playerId);
    try {
      await fetch('/api/squad', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, playerId, lineupStatus: null }),
      });
      setPlayers((prev) =>
        prev.map((p) => (p.id === playerId ? { ...p, lineupStatus: undefined } : p)),
      );
    } finally {
      setActionId(null);
    }
  }

  async function setAvailabilityPct(playerId: number, pct: number) {
    setActionId(playerId);
    try {
      await fetch('/api/squad', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, playerId, availabilityPct: pct }),
      });
      setPlayers((prev) =>
        prev.map((p) => (p.id === playerId ? { ...p, availabilityPct: pct } : p)),
      );
    } finally {
      setActionId(null);
    }
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (players.length === 0) {
    return (
      <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-20 text-center">
        <p className="text-gray-400">No squad saved yet.</p>
        <Link
          href={`/league/${leagueId}`}
          className="mt-4 inline-block rounded-xl bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20"
        >
          Build Squad
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryPill count={injuredPlayers.length}   label="Injured"    color="red"    />
        <SummaryPill count={suspendedPlayers.length} label="Suspended"  color="orange" />
        <SummaryPill count={doubtfulPlayers.length}  label="Doubtful"   color="yellow" />
        <SummaryPill count={players.length - totalConcerns} label="Available" color="green" />
        <div className="ml-auto">
          <button
            onClick={refreshAll}
            disabled={refreshing}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {refreshing ? 'Refreshing…' : 'Refresh all'}
          </button>
        </div>
      </div>

      {/* ── Injured ── */}
      {injuredPlayers.length > 0 && (
        <Section title="Injured" count={injuredPlayers.length} accent="border-red-500/20">
          {injuredPlayers.map((player) => {
            const info = injuries[player.id];
            const returning = info ? isToday(info) : false;
            const isManual = !info && player.lineupStatus === 'injured';

            return (
              <PlayerRow key={player.id} player={player}>
                <div className="min-w-0 flex-1">
                  {info ? (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-red-400">{info.name}</span>
                        {info.overridden && (
                          <span className="rounded bg-yellow-900/50 px-1 py-0.5 text-[10px] font-bold text-yellow-400">
                            custom
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {returning ? (
                          <span className="font-semibold text-green-400">Returns today!</span>
                        ) : info.expectedReturn ? (
                          <>Return: {info.expectedReturn}</>
                        ) : (
                          'Return date unknown'
                        )}
                      </p>
                      {info.lastUpdated && (
                        <p className="text-[10px] text-gray-700">
                          Updated {new Date(info.lastUpdated).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short',
                          })}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="font-semibold text-red-400">
                      Injured {isManual && <span className="text-[10px] font-normal text-gray-500">(manually set)</span>}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => clearInjury(player.id)}
                    disabled={actionId === player.id}
                    className="rounded-lg bg-green-900/40 px-2.5 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                  >
                    {actionId === player.id ? '…' : 'Healed'}
                  </button>
                  <Link
                    href={`/league/${leagueId}/team`}
                    className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white"
                  >
                    Edit
                  </Link>
                </div>
              </PlayerRow>
            );
          })}
        </Section>
      )}

      {/* ── Suspended ── */}
      {suspendedPlayers.length > 0 && (
        <Section title="Suspended" count={suspendedPlayers.length} accent="border-orange-500/20">
          {suspendedPlayers.map((player) => (
            <PlayerRow key={player.id} player={player}>
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-orange-400">Suspended</span>
                <p className="mt-0.5 text-xs text-gray-500">Manually set</p>
              </div>
              <button
                onClick={() => clearStatus(player.id)}
                disabled={actionId === player.id}
                className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {actionId === player.id ? '…' : 'Clear'}
              </button>
            </PlayerRow>
          ))}
        </Section>
      )}

      {/* ── Doubtful / limited availability ── */}
      {doubtfulPlayers.length > 0 && (
        <Section title="Limited availability" count={doubtfulPlayers.length} accent="border-yellow-500/20">
          {doubtfulPlayers.map((player) => {
            const pct = player.availabilityPct ?? 100;
            return (
              <PlayerRow key={player.id} player={player}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-yellow-400">{pct}% available</span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-yellow-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">Expected playing time</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => setAvailabilityPct(player.id, 100)}
                    disabled={actionId === player.id}
                    className="rounded-lg bg-green-900/40 px-2.5 py-1.5 text-xs font-semibold text-green-400 transition hover:bg-green-900/70 disabled:opacity-40"
                  >
                    {actionId === player.id ? '…' : 'Full'}
                  </button>
                </div>
              </PlayerRow>
            );
          })}
        </Section>
      )}

      {/* ── All clear ── */}
      {totalConcerns === 0 && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/15 px-8 py-12 text-center">
          <p className="text-lg font-bold text-emerald-400">All clear</p>
          <p className="mt-1 text-sm text-gray-500">No injuries, suspensions, or availability concerns.</p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryPill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: 'red' | 'orange' | 'yellow' | 'green';
}) {
  const cls = {
    red:    'bg-red-950/50 text-red-400 border-red-500/20',
    orange: 'bg-orange-950/50 text-orange-400 border-orange-500/20',
    yellow: 'bg-yellow-950/50 text-yellow-400 border-yellow-500/20',
    green:  'bg-emerald-950/50 text-emerald-400 border-emerald-500/20',
  }[color];

  return (
    <div className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 ${cls}`}>
      <span className="text-lg font-bold tabular-nums">{count}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="text-xs text-gray-600">({count})</span>
      </div>
      <div className={`divide-y divide-white/5 overflow-hidden rounded-2xl border ${accent}`}>
        {children}
      </div>
    </section>
  );
}

function PlayerRow({ player, children }: { player: SquadPlayer; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 bg-gray-900/60 px-4 py-3 sm:px-5">
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-800">
        <Image src={player.imageUrl} alt={player.name} fill className="object-cover" unoptimized />
      </div>
      <div className="min-w-0 w-36 shrink-0">
        <p className="truncate text-sm font-semibold text-white">{player.name}</p>
        <p className="truncate text-xs text-gray-500">{player.position} · {player.teamName}</p>
      </div>
      {children}
    </div>
  );
}
