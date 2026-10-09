'use client';

import { useState, useEffect } from 'react';
import type { SquadPlayer, MantraPosition, LineupStatus } from '@/types/squad';
import type { PlayerInjuryInfo, PlayerSeasonStats } from '@/lib/fotmob';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';
import { POSITION_SECTIONS, effectivePositionGroup } from '@/lib/positionGroups';
import { matchMantraPlayer } from '@/lib/nameMatch';
import type { MantraPlayer } from '@/lib/mantraFootball';
import type { PlayerSuspensionInfo } from '@/lib/suspensionCheck';
import { PlayerCard, SectionHeader, type PlayerForm } from '@/components/team/PlayerCard';
import { InjuryReportSection } from '@/components/team/InjuryReportSection';

function samePositions(a: MantraPosition[], b: MantraPosition[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((p) => setB.has(p));
}

const MANTRA_POSITION_ORDER = Object.fromEntries(MANTRA_POSITIONS.map((p, i) => [p.code, i]));

interface Props {
  leagueId: number;
  initialPlayers: SquadPlayer[];
  injuries: Record<number, PlayerInjuryInfo>;
  primaryColor: string;
  initialForm?: Record<number, PlayerForm>;
  seasonStats?: Record<number, PlayerSeasonStats>;
  initialSuspensions?: Record<number, PlayerSuspensionInfo>;
}

export default function TeamSquadView({
  leagueId, initialPlayers, injuries: initialInjuries, primaryColor, initialForm, seasonStats, initialSuspensions,
}: Props) {
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
      prev.map((p) => (p.id === playerId ? { ...p, lineupStatus: newStatus ?? undefined, lineupStatusSource: 'manual' } : p)),
    );
    await fetch('/api/squad', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId, lineupStatus: newStatus, lineupStatusSource: 'manual' }),
    });
  }

  const [suspensions, setSuspensions] = useState<Record<number, PlayerSuspensionInfo>>(initialSuspensions ?? {});
  const [checkingSuspensions, setCheckingSuspensions] = useState(false);
  const [suspensionSummary, setSuspensionSummary] = useState<string | null>(null);

  /** Only the certain case (red/2nd-yellow last match) auto-sets Suspended — see suspensionCheck.ts. */
  function applySuspensions(infoByPlayer: Record<number, PlayerSuspensionInfo>) {
    let updated = 0;
    const patches: Promise<unknown>[] = [];
    const nextPlayers = players.map((p) => {
      const info = infoByPlayer[p.id];
      if (!info || p.lineupStatusSource === 'manual') return p;

      const shouldBeSuspended = info.redCardLastMatch;
      const isAutoSuspended = p.lineupStatus === 'suspended' && p.lineupStatusSource === 'auto';
      if (shouldBeSuspended === isAutoSuspended) return p;

      updated += 1;
      const nextStatus: LineupStatus | undefined = shouldBeSuspended ? 'suspended' : undefined;
      patches.push(
        fetch('/api/squad', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId, playerId: p.id, lineupStatus: nextStatus ?? null, lineupStatusSource: 'auto',
          }),
        }),
      );
      return { ...p, lineupStatus: nextStatus, lineupStatusSource: 'auto' as const };
    });

    setPlayers(nextPlayers);
    return { patches, updated };
  }

  useEffect(() => {
    if (!initialSuspensions) return;
    const { patches } = applySuspensions(initialSuspensions);
    void Promise.all(patches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkSuspensions() {
    setCheckingSuspensions(true);
    setSuspensionSummary(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/suspensions`);
      const data = await res.json();
      const infoByPlayer: Record<number, PlayerSuspensionInfo> = data.players ?? {};
      setSuspensions(infoByPlayer);
      const { patches, updated } = applySuspensions(infoByPlayer);
      await Promise.all(patches);
      setSuspensionSummary(updated === 0 ? 'No changes' : `Updated ${updated}`);
    } finally {
      setCheckingSuspensions(false);
    }
  }

  async function setAvailabilityPct(
    playerId: number,
    pct: number,
    source: 'manual' | 'suggested' = 'manual',
  ) {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, availabilityPct: pct, availabilityPctSource: source } : p)),
    );
    await fetch('/api/squad', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId, availabilityPct: pct, availabilityPctSource: source }),
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
      name: info?.cleared ? '' : (info?.name ?? ''),
      expectedReturnDate: info?.cleared ? '' : (info?.expectedReturnDate ?? ''),
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
      const res = await fetch(`/api/players/${playerId}/injury`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleared: true }),
      });
      const data = await res.json();
      setInjuries((prev) => ({ ...prev, [playerId]: data.injury }));
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

  const [syncingPositions, setSyncingPositions] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  async function syncMantraPositions() {
    setSyncingPositions(true);
    setSyncSummary(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/mantra-positions`);
      const data = await res.json();
      const mantraPlayers: MantraPlayer[] = data.players ?? [];

      let updated = 0;
      let unmatched = 0;
      const patches: Promise<unknown>[] = [];

      const nextPlayers = players.map((p) => {
        const match = matchMantraPlayer({ name: p.name, teamName: p.teamName }, mantraPlayers);
        if (!match || match.positions.length === 0) {
          unmatched += 1;
          return p;
        }
        if (samePositions(match.positions, p.mantraPositions)) return p;

        updated += 1;
        patches.push(
          fetch('/api/squad', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leagueId, playerId: p.id, mantraPositions: match.positions }),
          }),
        );
        return { ...p, mantraPositions: match.positions };
      });

      setPlayers(nextPlayers);
      await Promise.all(patches);
      setSyncSummary(`Updated ${updated}${unmatched > 0 ? `, ${unmatched} unmatched` : ''}`);
    } finally {
      setSyncingPositions(false);
    }
  }

  const [form, setForm] = useState<Record<number, PlayerForm>>(initialForm ?? {});
  const [updatingForm, setUpdatingForm] = useState(false);
  const [formSummary, setFormSummary] = useState<string | null>(null);

  const [refreshingTeams, setRefreshingTeams] = useState(false);
  const [teamRefreshSummary, setTeamRefreshSummary] = useState<string | null>(null);

  /**
   * A saved squad's teamId/teamName is a snapshot from add/import time — a
   * transfer leaves it stale with no other signal, since nothing else in the
   * app re-checks it. This re-syncs every player against FotMob's current
   * primaryTeam and reports what moved.
   */
  async function refreshTeamInfo() {
    setRefreshingTeams(true);
    setTeamRefreshSummary(null);
    try {
      const results = await Promise.all(
        players.map((p) =>
          fetch(`/api/players/${p.id}/team`)
            .then((r) => r.json())
            .then((d) => ({ id: p.id, team: d.team as { teamId: number; teamName: string } | null }))
            .catch(() => ({ id: p.id, team: null })),
        ),
      );

      let moved = 0;
      const patches: Promise<unknown>[] = [];
      const movedNames: string[] = [];

      const nextPlayers = players.map((p) => {
        const entry = results.find((r) => r.id === p.id);
        const team = entry?.team;
        if (!team || team.teamId === p.teamId) return p;

        moved += 1;
        movedNames.push(`${p.name} → ${team.teamName}`);
        patches.push(
          fetch('/api/squad', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leagueId, playerId: p.id, teamId: team.teamId, teamName: team.teamName }),
          }),
        );
        return { ...p, teamId: team.teamId, teamName: team.teamName };
      });

      setPlayers(nextPlayers);
      await Promise.all(patches);
      setTeamRefreshSummary(
        moved === 0 ? 'All up to date' : `Updated ${moved}: ${movedNames.join(', ')}`,
      );
    } finally {
      setRefreshingTeams(false);
    }
  }

  async function fetchPlayerForm(player: SquadPlayer): Promise<PlayerForm> {
    const res = await fetch(
      `/api/players/${player.id}/form?positionGroup=${player.positionGroup}`,
    );
    return res.json();
  }

  /** Applies suggested Start % for every player whose value isn't manually overridden. */
  function applyFormResults(entries: { id: number; f: PlayerForm }[]) {
    const nextForm: Record<number, PlayerForm> = { ...form };
    let updated = 0;
    let noData = 0;
    const patches: Promise<unknown>[] = [];

    const nextPlayers = players.map((p) => {
      const entry = entries.find((r) => r.id === p.id);
      if (!entry) return p;
      nextForm[p.id] = entry.f;

      if (p.availabilityPctSource === 'manual') return p;
      if (entry.f.suggestedPct == null) { noData += 1; return p; }
      if (entry.f.suggestedPct === (p.availabilityPct ?? 100) && p.availabilityPctSource === 'suggested') return p;

      updated += 1;
      patches.push(
        fetch('/api/squad', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId, playerId: p.id, availabilityPct: entry.f.suggestedPct, availabilityPctSource: 'suggested',
          }),
        }),
      );
      return { ...p, availabilityPct: entry.f.suggestedPct, availabilityPctSource: 'suggested' as const };
    });

    setForm(nextForm);
    setPlayers(nextPlayers);
    return { patches, updated, noData };
  }

  // Apply the server-prefetched suggestions once on load — Start % should reflect
  // recent form without requiring a manual click every time the page is opened.
  useEffect(() => {
    if (!initialForm) return;
    const entries = Object.entries(initialForm).map(([id, f]) => ({ id: Number(id), f }));
    const { patches } = applyFormResults(entries);
    void Promise.all(patches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStartPercentages() {
    setUpdatingForm(true);
    setFormSummary(null);
    try {
      const results = await Promise.all(
        players.map((p) => fetchPlayerForm(p).then((f) => ({ id: p.id, f })).catch(() => null)),
      );
      const { patches, updated, noData } = applyFormResults(results.filter((r) => r !== null));
      await Promise.all(patches);
      setFormSummary(`Updated ${updated}${noData > 0 ? `, ${noData} no data` : ''}`);
    } finally {
      setUpdatingForm(false);
    }
  }

  async function resetToAuto(player: SquadPlayer) {
    const f = form[player.id] ?? (await fetchPlayerForm(player));
    setForm((prev) => ({ ...prev, [player.id]: f }));
    if (f.suggestedPct != null) {
      await setAvailabilityPct(player.id, f.suggestedPct, 'suggested');
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

  const injuredPlayers = players.filter((p) => injuries[p.id] != null && !injuries[p.id]!.cleared);

  return (
    <div className="space-y-10">
      {/* ── Injury report ── */}
      <InjuryReportSection
        injuredPlayers={injuredPlayers}
        injuries={injuries}
        editingInjuryId={editingInjuryId}
        editForm={editForm}
        onEditFormChange={setEditForm}
        savingInjury={savingInjury}
        injuryActionId={injuryActionId}
        refreshingInjuries={refreshingInjuries}
        onRefresh={refreshInjuries}
        onStartEdit={startEditInjury}
        onCancelEdit={() => setEditingInjuryId(null)}
        onClear={clearInjury}
        onResetToFotmob={resetToFotmob}
        onSave={saveInjury}
      />

      {/* ── Sync positions from MantraFootball / Update Start % from form ── */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {syncSummary && <span className="text-xs text-gray-500">{syncSummary}</span>}
        <button
          onClick={syncMantraPositions}
          disabled={syncingPositions}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {syncingPositions ? 'Syncing…' : 'Sync positions from MantraFootball'}
        </button>
        {formSummary && <span className="text-xs text-gray-500">{formSummary}</span>}
        <button
          onClick={updateStartPercentages}
          disabled={updatingForm}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {updatingForm ? 'Updating…' : 'Update Start % from form'}
        </button>
        {teamRefreshSummary && <span className="max-w-md text-right text-xs text-gray-500">{teamRefreshSummary}</span>}
        <button
          onClick={refreshTeamInfo}
          disabled={refreshingTeams}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {refreshingTeams ? 'Checking…' : 'Refresh team info'}
        </button>
        {suspensionSummary && <span className="text-xs text-gray-500">{suspensionSummary}</span>}
        <button
          onClick={checkSuspensions}
          disabled={checkingSuspensions}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {checkingSuspensions ? 'Checking…' : 'Check suspensions'}
        </button>
      </div>

      {/* ── Players by position group ── */}
      {POSITION_SECTIONS.map(({ group, label }) => {
        const groupPlayers = players
          .filter((p) => effectivePositionGroup(p) === group)
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
                  form={form[player.id]}
                  seasonStats={seasonStats?.[player.id]}
                  suspensionInfo={suspensions[player.id]}
                  isEditing={editingId === player.id}
                  onEditToggle={() => setEditingId((id) => (id === player.id ? null : player.id))}
                  onTogglePosition={(pos) => togglePosition(player.id, pos)}
                  onToggleStatus={(s) => toggleLineupStatus(player.id, s)}
                  onSetAvailability={(pct) => setAvailabilityPct(player.id, pct, 'manual')}
                  onResetToAuto={() => resetToAuto(player)}
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
