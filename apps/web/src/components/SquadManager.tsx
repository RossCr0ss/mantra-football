'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { FotMobTeam, FotMobPlayer, PlayerInjuryInfo } from '@/lib/fotmob';
import type { SquadPlayer } from '@/types/squad';
import { SQUAD_RULES } from '@/types/squad';
import { useSquadStore } from '@/store/squadStore';
import { guessMantraPositions } from '@/lib/mantraPositions';

function isInjuryToday(info: PlayerInjuryInfo): boolean {
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

type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABELS: Record<Position, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};
const PAGE_SIZE = 12;
const POSITION_ORDER: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

function validateSquad(squad: SquadPlayer[]): string | null {
  if (squad.length !== SQUAD_RULES.total) {
    return `Squad must have exactly ${SQUAD_RULES.total} players (currently ${squad.length}).`;
  }
  const gkCount = squad.filter((p) => p.positionGroup === 'GK').length;
  if (gkCount !== SQUAD_RULES.goalkeepers) {
    return `Squad must have exactly ${SQUAD_RULES.goalkeepers} goalkeepers (currently ${gkCount}).`;
  }
  return null;
}

interface Props {
  leagueId: number;
  initialPlayers: SquadPlayer[];
}

export default function SquadManager({ leagueId, initialPlayers }: Props) {
  const router = useRouter();
  const { squad, setLeagueId, setSquad, addPlayer, removePlayer } = useSquadStore();

  const [teams, setTeams] = useState<FotMobTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<FotMobTeam | null>(null);
  const [teamPlayers, setTeamPlayers] = useState<FotMobPlayer[]>([]);
  const [position, setPosition] = useState<Position>('GK');
  const [page, setPage] = useState(1);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setLeagueId(leagueId);
    setSquad(initialPlayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    fetch(`/api/leagues/${leagueId}/teams`)
      .then((r) => r.json())
      .then((d) => setTeams(d.teams ?? []))
      .finally(() => setLoadingTeams(false));
  }, [leagueId]);

  useEffect(() => {
    if (!selectedTeam) return;
    setLoadingPlayers(true);
    setTeamPlayers([]);
    setPage(1);
    fetch(`/api/teams/${selectedTeam.id}/players?teamName=${encodeURIComponent(selectedTeam.name)}`)
      .then((r) => r.json())
      .then((d) => setTeamPlayers(d.players ?? []))
      .finally(() => setLoadingPlayers(false));
  }, [selectedTeam]);

  useEffect(() => { setPage(1); }, [position]);

  const filtered = teamPlayers.filter((p) => p.position === position);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const gkCount = squad.filter((p) => p.positionGroup === 'GK').length;
  const remaining = SQUAD_RULES.total - squad.length;
  const progress = Math.min(100, (squad.length / SQUAD_RULES.total) * 100);

  function handleAdd(p: FotMobPlayer) {
    setValidationError(null);
    addPlayer({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      teamName: p.teamName,
      position: p.positionLabel,
      positionGroup: p.position,
      imageUrl: p.imageUrl,
      injured: p.injured,
      mantraPositions: guessMantraPositions(p.positionLabel, p.position),
    });
  }

  function handleRemove(id: number) {
    setValidationError(null);
    removePlayer(id);
  }

  async function saveSquad() {
    const error = validateSquad(squad);
    if (error) { setValidationError(error); return; }
    setSaving(true);
    try {
      await fetch('/api/squad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, players: squad }),
      });
      router.refresh();
      router.push(`/league/${leagueId}/team`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
      {/* ── Left: team selector + player browser ── */}
      <div className="space-y-6 min-w-0">
        {/* Team selector */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Select Team
          </p>
          {loadingTeams ? (
            <TeamsSkeleton />
          ) : (
            <div className="flex flex-wrap gap-2">
              {teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeam(team)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    selectedTeam?.id === team.id
                      ? 'border-white/30 bg-white/10 text-white'
                      : 'border-white/8 text-gray-400 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <div className="relative h-5 w-5 shrink-0">
                    <Image src={team.logoUrl} alt={team.name} fill className="object-contain" unoptimized />
                  </div>
                  {team.shortName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Player browser */}
        {selectedTeam && (
          <div>
            {/* Position tabs */}
            <div className="mb-4 flex gap-0.5 rounded-xl border border-white/8 bg-gray-900 p-1">
              {POSITIONS.map((pos) => {
                const count = teamPlayers.filter((p) => p.position === pos).length;
                return (
                  <button
                    key={pos}
                    onClick={() => setPosition(pos)}
                    className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                      position === pos ? 'bg-white text-gray-900' : 'text-gray-500 hover:text-white'
                    }`}
                  >
                    {pos}
                    {count > 0 && (
                      <span className="ml-1 text-xs opacity-50">({count})</span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mb-3 text-xs text-gray-500">
              {POSITION_LABELS[position]} · {selectedTeam.name}
            </p>

            {loadingPlayers ? (
              <PlayersSkeleton />
            ) : paginated.length === 0 ? (
              <p className="rounded-xl border border-white/8 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
                No players found
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {paginated.map((player) => (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      inSquad={squad.some((s) => s.id === player.id)}
                      onAdd={() => handleAdd(player)}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="rounded-lg border border-white/10 px-4 py-1.5 text-sm text-gray-400 transition hover:border-white/25 hover:text-white disabled:opacity-25"
                    >
                      ←
                    </button>
                    <span className="text-xs tabular-nums text-gray-500">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="rounded-lg border border-white/10 px-4 py-1.5 text-sm text-gray-400 transition hover:border-white/25 hover:text-white disabled:opacity-25"
                    >
                      →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Right: squad panel ── */}
      <div className="lg:border-l lg:border-white/8 lg:pl-8">
        {/* Header + progress */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">My Squad</h2>
            <span className={`text-sm font-bold tabular-nums ${squad.length === SQUAD_RULES.total ? 'text-green-400' : 'text-gray-400'}`}>
              {squad.length} / {SQUAD_RULES.total}
            </span>
          </div>

          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-green-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 flex gap-3 text-xs text-gray-600">
            <span>
              GK:{' '}
              <span className={gkCount === SQUAD_RULES.goalkeepers ? 'text-green-400' : 'text-white'}>
                {gkCount}/{SQUAD_RULES.goalkeepers}
              </span>
            </span>
            {remaining > 0 && <span>{remaining} spot{remaining !== 1 ? 's' : ''} left</span>}
          </div>
        </div>

        {validationError && (
          <div className="mb-4 rounded-xl border border-red-500/25 bg-red-950/30 px-4 py-3 text-xs text-red-400">
            {validationError}
          </div>
        )}

        <button
          onClick={saveSquad}
          disabled={saving || squad.length === 0}
          className="mb-4 w-full rounded-xl bg-green-700 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save & View Team'}
        </button>

        {squad.length === 0 ? (
          <p className="rounded-xl border border-white/8 bg-gray-900 px-4 py-8 text-center text-xs text-gray-600">
            Add players from the left panel
          </p>
        ) : (
          <div className="space-y-1.5">
            {[...squad]
              .sort((a, b) => POSITION_ORDER[a.positionGroup] - POSITION_ORDER[b.positionGroup])
              .map((player) => (
                <SquadListItem
                  key={player.id}
                  player={player}
                  onRemove={() => handleRemove(player.id)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Squad list item ──────────────────────────────────────────────────────────

function SquadListItem({ player, onRemove }: { player: SquadPlayer; onRemove: () => void }) {
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
            {injury && isInjuryToday(injury) ? (
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

function PlayerCard({
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
              {injury && isInjuryToday(injury) ? (
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

function TeamsSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="shimmer h-9 w-20 rounded-xl" />
      ))}
    </div>
  );
}

function PlayersSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-white/8 bg-gray-900">
          <div className="shimmer h-32 w-full" />
          <div className="flex flex-col gap-2 p-3">
            <div className="shimmer mx-auto h-3 w-20 rounded" />
            <div className="shimmer mx-auto h-2.5 w-14 rounded" />
            <div className="shimmer h-7 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
