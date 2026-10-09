'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { FotMobTeam, FotMobPlayer } from '@/lib/fotmob';
import type { SquadPlayer } from '@/types/squad';
import { SQUAD_RULES } from '@/types/squad';
import { useSquadStore } from '@/store/squadStore';
import { guessMantraPositions } from '@/lib/mantraPositions';
import { POSITION_ORDER } from '@/lib/positionGroups';
import { matchMantraPlayer } from '@/lib/nameMatch';
import type { MantraPlayer } from '@/lib/mantraFootball';
import { CatalogPlayerCard, SquadListItem } from '@/components/squad/SquadCards';
import { PlayersSkeleton, TeamsSkeleton } from '@/components/squad/SquadSkeletons';

type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABELS: Record<Position, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};
const PAGE_SIZE = 12;

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
  const [mantraPlayers, setMantraPlayers] = useState<MantraPlayer[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<FotMobTeam | null>(null);
  const [teamPlayers, setTeamPlayers] = useState<FotMobPlayer[]>([]);
  const [position, setPosition] = useState<Position>('GK');
  const [page, setPage] = useState(1);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [mantraAuthed, setMantraAuthed] = useState<boolean | null>(null);
  const [mantraEmail, setMantraEmail] = useState('');
  const [mantraPassword, setMantraPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [mantraTeamId, setMantraTeamId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importUnmatched, setImportUnmatched] = useState<string[]>([]);

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
    fetch(`/api/leagues/${leagueId}/mantra-positions`)
      .then((r) => r.json())
      .then((d) => setMantraPlayers(d.players ?? []))
      .catch(() => setMantraPlayers([]));
  }, [leagueId]);

  useEffect(() => {
    fetch('/api/mantra-auth/login')
      .then((r) => r.json())
      .then((d) => setMantraAuthed(!!d.authenticated))
      .catch(() => setMantraAuthed(false));
  }, []);

  async function handleMantraLogin() {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/mantra-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mantraEmail, password: mantraPassword }),
      });
      const data = await res.json();
      if (!data.ok) {
        setLoginError(data.error ?? 'Login failed');
        return;
      }
      setMantraAuthed(true);
      setMantraPassword('');
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleMantraImport() {
    setImporting(true);
    setImportError(null);
    setImportUnmatched([]);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/mantra-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mantraTeamId: Number(mantraTeamId) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? 'Import failed');
        return;
      }
      setSquad(data.players ?? []);
      setImportUnmatched(data.unmatched ?? []);
    } finally {
      setImporting(false);
    }
  }

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
    const mantraMatch = matchMantraPlayer({ name: p.name, teamName: p.teamName }, mantraPlayers);
    addPlayer({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      teamName: p.teamName,
      position: p.positionLabel,
      positionGroup: p.position,
      imageUrl: p.imageUrl,
      injured: p.injured,
      mantraPositions: mantraMatch?.positions.length
        ? mantraMatch.positions
        : guessMantraPositions(p.positionLabel, p.position),
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
      const res = await fetch('/api/squad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, players: squad }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: null }));
        setValidationError(msg ?? 'Failed to save squad.');
        return;
      }
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
        {/* Import from MantraFootball */}
        <div className="rounded-xl border border-white/8 bg-gray-900 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Import from MantraFootball
          </p>

          {mantraAuthed === false ? (
            <div className="space-y-2">
              <input
                type="email"
                value={mantraEmail}
                onChange={(e) => setMantraEmail(e.target.value)}
                placeholder="MantraFootball email"
                className="w-full rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 transition focus:border-white/25 focus:outline-none"
              />
              <input
                type="password"
                value={mantraPassword}
                onChange={(e) => setMantraPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 transition focus:border-white/25 focus:outline-none"
              />
              {loginError && <p className="text-xs text-red-400">{loginError}</p>}
              <button
                onClick={handleMantraLogin}
                disabled={loggingIn || !mantraEmail || !mantraPassword}
                className="w-full rounded-lg bg-white/8 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                {loggingIn ? 'Logging in…' : 'Log in'}
              </button>
            </div>
          ) : mantraAuthed === true ? (
            <div className="space-y-2">
              <input
                type="text"
                value={mantraTeamId}
                onChange={(e) => setMantraTeamId(e.target.value)}
                placeholder="Your MantraFootball team id (e.g. 840)"
                className="w-full rounded-lg border border-white/10 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 transition focus:border-white/25 focus:outline-none"
              />
              {importError && <p className="text-xs text-red-400">{importError}</p>}
              {importUnmatched.length > 0 && (
                <p className="text-xs text-yellow-400">
                  {importUnmatched.length} unmatched — add manually: {importUnmatched.join(', ')}
                </p>
              )}
              <button
                onClick={handleMantraImport}
                disabled={importing || !mantraTeamId}
                className="w-full rounded-lg bg-white/8 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                {importing ? 'Importing…' : 'Import squad'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-600">Checking login status…</p>
          )}
        </div>

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
                    <CatalogPlayerCard
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
