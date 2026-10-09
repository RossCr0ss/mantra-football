'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import LeagueNav from '@/components/LeagueNav';
import { ProgressBar } from '@/components/LoadingProgressBar';
import { LEAGUES } from '@/lib/leagues';
import type { TeamFixture, FixtureOdds } from '@/lib/fotmob';
import type { SquadPlayer } from '@/types/squad';
import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import type { PlayerRecentMatch } from '@/lib/fotmob';
import { POSITION_ORDER, POSITION_SECTIONS, effectivePositionGroup } from '@/lib/positionGroups';
import { MODULES, effectiveScore, enrichPlayers, pickBestModule, type EnrichedPlayer } from '@/lib/tourModules';
import { isBlocked } from '@/lib/tourScoring';
import { applyLiveInjuries } from '@/lib/liveInjuries';
import { fetchJsonCached, CACHE_KEY } from '@/lib/clientCache';
import { PitchView } from '@/components/tour/PitchView';
import { MainCard, SquadRow, StatBadge, TourSkeleton } from '@/components/tour/TourCards';

export default function TourPage() {
  const params = useParams<{ id: string }>();
  const leagueId = Number(params.id);
  const league = LEAGUES.find((l) => l.id === leagueId);

  const [players, setPlayers] = useState<EnrichedPlayer[]>([]);
  const [loadingMain, setLoadingMain] = useState(true);
  const [, setLoadingOdds] = useState(false);
  const [mainIds, setMainIds] = useState<Set<number>>(new Set());
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [appliedModule, setAppliedModule] = useState<string | null>(null);
  /** Team defence bonus (Mantra points, 0–5) of the last auto-select. */
  const [appliedDefenceBonus, setAppliedDefenceBonus] = useState(0);
  /** Slot-ordered IDs from the last auto-select (index 0 = GK, 1-10 = outfield slots). */
  const [mainSlots, setMainSlots] = useState<number[]>([]);
  /** Score penalty per slot from the last auto-select (0 = native, -1.5 or -3 = out of position). */
  const [mainSlotsPenalty, setMainSlotsPenalty] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'tactics'>('grid');
  const autoSelectedRef = useRef(false);
  const [isCalculating, startCalculation] = useTransition();

  const [fixtures, setFixtures]     = useState<Record<number, TeamFixture[]>>({});
  const [analyticsMap, setAnalyticsMap] = useState<Map<number, PlayerAnalytics>>(new Map());
  const [oddsMap, setOddsMap]       = useState<Map<string, FixtureOdds | null>>(new Map());
  const [formMap, setFormMap]       = useState<Map<number, PlayerRecentMatch[]>>(new Map());
  const [squad, setSquad]           = useState<SquadPlayer[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (squad.length === 0) return;
    setPlayers(enrichPlayers(squad, fixtures, analyticsMap, oddsMap, formMap));
  }, [squad, fixtures, analyticsMap, oddsMap, formMap]);

  // Auto-select once when players first load
  useEffect(() => {
    if (players.length === 0 || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    autoSelect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  // Re-run auto-select when formation chip changes (only after initial load)
  useEffect(() => {
    if (!autoSelectedRef.current || players.length === 0) return;
    autoSelect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule]);

  useEffect(() => {
    setLoadingMain(true);
    if (refreshKey > 0) setRefreshing(true);

    const refresh = forceRefreshRef.current;
    forceRefreshRef.current = false;

    Promise.all([
      fetch(`/api/squad?leagueId=${leagueId}`).then((r) => r.json()),
      // Live injuries are not session-cached (the user can mark players "Healed" on other pages); a failure is non-fatal.
      fetch(`/api/leagues/${leagueId}/injuries`).then((r) => (r.ok ? r.json() : { injuries: {} })).catch(() => ({ injuries: {} })),
      fetchJsonCached<{ fixtures?: Record<number, TeamFixture[]> }>(
        CACHE_KEY.fixtures(leagueId), `/api/leagues/${leagueId}/fixtures`, { refresh },
      ),
      fetchJsonCached<{ players?: PlayerAnalytics[] }>(
        CACHE_KEY.analytics(leagueId), `/api/leagues/${leagueId}/analytics`, { refresh },
      ),
    ]).then(([squadData, injuryData, fixtureData, analyticsData]) => {
      const loadedSquad: SquadPlayer[] = applyLiveInjuries(squadData.players ?? [], injuryData.injuries ?? {});
      const loadedFixtures: Record<number, TeamFixture[]> = fixtureData.fixtures ?? {};
      const loadedAnalytics: PlayerAnalytics[] = analyticsData.players ?? [];

      const aMap = new Map<number, PlayerAnalytics>();
      for (const a of loadedAnalytics) aMap.set(a.playerId, a);

      setSquad(loadedSquad);
      setFixtures(loadedFixtures);
      setAnalyticsMap(aMap);
      setLoadingMain(false);
      setRefreshing(false);

      const uniqueMatchIds = Array.from(
        new Set(Object.values(loadedFixtures).flat().map((f) => f.matchId)),
      );
      if (uniqueMatchIds.length > 0) {
        setLoadingOdds(true);
        Promise.all(
          uniqueMatchIds.map((id) =>
            fetch(`/api/matches/${id}/odds`)
              .then((r) => r.json())
              .then((d) => [id, (d.odds as FixtureOdds | null)] as const)
              .catch(() => [id, null] as const),
          ),
        ).then((entries) => setOddsMap(new Map(entries)))
          .finally(() => setLoadingOdds(false));
      }

      fetchJsonCached<{ form?: Record<string, PlayerRecentMatch[]> }>(
        CACHE_KEY.form(leagueId), `/api/leagues/${leagueId}/form`, { refresh },
      )
        .then((d) => {
          const fMap = new Map<number, PlayerRecentMatch[]>();
          for (const [k, v] of Object.entries(d.form ?? {})) fMap.set(Number(k), v);
          setFormMap(fMap);
        })
        .catch(() => {});
    }).catch(() => { setLoadingMain(false); setRefreshing(false); });
  }, [leagueId, refreshKey]);

  // ── Auto-select ───────────────────────────────────────────────────────────────
  function autoSelect() {
    const available = players.filter((p) => !isBlocked(p));
    // Pinned chip → that formation; otherwise the formation with the highest total effective score
    // plus the team defence bonus (see pickBestModule in lib/tourModules.ts).
    const best = pickBestModule(available, selectedModule);
    if (!best) return;

    const { ids, penalty } = best.assignment;
    startCalculation(() => {
      setMainIds(new Set<number>(ids));
      setAppliedModule(best.moduleName);
      setAppliedDefenceBonus(best.defenceBonus);
      setMainSlots(ids);
      setMainSlotsPenalty(penalty);
      setViewMode('tactics');
    });
  }

  function refreshData() {
    forceRefreshRef.current = true; // bypass session cache AND ask the server to refresh its Mongo cache
    autoSelectedRef.current = false;
    setRefreshKey((k) => k + 1);
  }

  function togglePlayer(playerId: number) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    // Manual edits invalidate slot assignments → fall back to grid view
    setMainSlots([]);
    setViewMode('grid');
    if (mainIds.has(playerId)) {
      setMainIds((prev) => { const n = new Set(prev); n.delete(playerId); return n; });
    } else {
      if (isBlocked(player) || mainIds.size >= 11) return;
      setMainIds((prev) => new Set(Array.from(prev).concat(playerId)));
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────────
  const mainCount    = mainIds.size;
  const gkMainCount  = players.filter((p) => mainIds.has(p.id) && effectivePositionGroup(p) === 'GK').length;
  const isValid      = mainCount === 11 && gkMainCount === 1;
  // Use per-slot effective scores (with malus) when auto-select has run; raw totals otherwise.
  const estimatedTotal = mainSlots.length === 11
    ? mainSlots.reduce((sum, id, i) => {
        const p = players.find((pl) => pl.id === id);
        const pen = mainSlotsPenalty[i] ?? 0;
        return sum + (p ? effectiveScore(p.scoreBreakdown, pen) : 0);
      }, 0)
    : players.filter((p) => mainIds.has(p.id)).reduce((sum, p) => sum + p.scoreBreakdown.total, 0);

  const mainPlayers = players
    .filter((p) => mainIds.has(p.id))
    .sort((a, b) => POSITION_ORDER[effectivePositionGroup(a)] - POSITION_ORDER[effectivePositionGroup(b)]);

  const canShowTactics = mainSlots.length === 11 && appliedModule !== null;
  // Build a lookup once so the map below is O(1) per entry, not O(n)
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const slottedPlayers: EnrichedPlayer[] = useMemo(
    () => (canShowTactics ? mainSlots.map((id) => playerById.get(id)).filter((p): p is EnrichedPlayer => p != null) : []),
    [canShowTactics, mainSlots, playerById],
  );

  const firstFix  = players.find((p) => p.nextFixture)?.nextFixture;
  const roundLabel = firstFix?.round ? `Round ${firstFix.round}` : null;

  return (
    <>
    <ProgressBar loading={loadingMain} />
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-5xl space-y-6">

        <Breadcrumbs />

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {league && (
              <div className="relative h-10 w-10 shrink-0">
                <Image src={league.logoUrl} alt={league.name} fill className="object-contain" unoptimized />
              </div>
            )}
            <div>
              <p className="text-sm text-gray-400">
                {league?.country}{roundLabel ? ` · ${roundLabel}` : ''}
              </p>
              <h1 className="text-2xl font-bold text-white">Tour Selector</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoSelect}
              disabled={loadingMain || players.length === 0}
              className="flex items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-200 disabled:opacity-40"
            >
              {isCalculating && (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-gray-900 animate-spin" />
              )}
              Auto-select
            </button>
            <button
              onClick={refreshData}
              disabled={loadingMain || refreshing}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:bg-gray-700 hover:text-white disabled:opacity-40"
            >
              {refreshing && (
                <span className="h-3 w-3 rounded-full border-2 border-gray-500 border-t-white animate-spin" />
              )}
              Refresh
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className={`flex flex-wrap items-center gap-5 rounded-2xl border px-5 py-4 ${
          isValid ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-white/8 bg-gray-900'
        }`}>
          <StatBadge label="Starting XI" value={`${mainCount} / 11`} ok={mainCount === 11} />
          <StatBadge label="GK" value={`${gkMainCount} / 1`} ok={gkMainCount === 1} />
          {mainCount > 0 && (
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-gray-300">{estimatedTotal.toFixed(1)}</p>
              <p className="text-[10px] text-gray-500">Est. score</p>
            </div>
          )}
          {appliedModule && (
            <div className="text-center">
              <p className="text-lg font-bold text-gray-300">{appliedModule}</p>
              <p className="text-[10px] text-gray-500">{selectedModule ? 'Formation' : 'Best formation'}</p>
            </div>
          )}
          {appliedModule && mainSlots.length === 11 && (
            <div className="text-center" title="Team bonus from the average base rating of the back line (0–5 points). Included when choosing the best formation.">
              <p className="text-lg font-bold tabular-nums text-gray-300">+{appliedDefenceBonus}</p>
              <p className="text-[10px] text-gray-500">Def. bonus</p>
            </div>
          )}
          {isValid && (
            <span className="ml-auto rounded-lg bg-emerald-900/60 px-3 py-1.5 text-sm font-semibold text-emerald-400">
              Ready ✓
            </span>
          )}
        </div>

        <LeagueNav leagueId={leagueId} />

        {/* Formation chips */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Formation</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedModule(null)}
              className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                selectedModule === null
                  ? 'border-white/40 bg-white/12 text-white'
                  : 'border-white/8 bg-gray-900 text-gray-500 hover:border-white/15 hover:text-gray-300'
              }`}
            >
              Best
            </button>
            {MODULES.map((mod) => (
              <button
                key={mod.name}
                onClick={() => setSelectedModule(mod.name)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                  selectedModule === mod.name
                    ? 'border-white/40 bg-white/12 text-white'
                    : 'border-white/8 bg-gray-900 text-gray-500 hover:border-white/15 hover:text-gray-300'
                }`}
              >
                {mod.name}
              </button>
            ))}
          </div>
        </div>
        {isCalculating && (
          <p className="text-xs text-gray-500 animate-pulse">Calculating best XI…</p>
        )}

        {loadingMain ? (
          <TourSkeleton />
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-16 text-center">
            <p className="text-gray-400">No squad saved yet.</p>
            <Link href={`/league/${leagueId}`} className="mt-4 inline-block rounded-xl bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20">
              Build Squad
            </Link>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── Starting XI ──────────────────────────────────────────────── */}
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Starting XI</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                  mainCount === 11 ? 'bg-emerald-900/60 text-emerald-400' : 'bg-gray-800 text-gray-400'
                }`}>{mainCount}/11</span>
                {mainCount < 11 && (
                  <span className="text-xs text-gray-600">Click a player below to add · click a card to remove</span>
                )}

                {/* View toggle — only available after auto-select */}
                {canShowTactics && (
                  <div className="ml-auto flex gap-0.5 rounded-lg border border-white/8 bg-gray-900 p-0.5">
                    {(['grid', 'tactics'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`rounded px-3 py-1 text-xs font-semibold capitalize transition ${
                          viewMode === mode
                            ? 'bg-white text-gray-900'
                            : 'text-gray-500 hover:text-white'
                        }`}
                      >
                        {mode === 'tactics' ? 'Tactics' : 'Grid'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {mainPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-gray-900/40 py-10 text-center">
                  <p className="text-sm text-gray-600">No players selected — press Auto-select or click players below</p>
                </div>
              ) : viewMode === 'tactics' && canShowTactics ? (
                <PitchView
                  slottedPlayers={slottedPlayers}
                  moduleName={appliedModule!}
                  slotsPenalty={mainSlotsPenalty}
                  onRemove={togglePlayer}
                />
              ) : (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {mainPlayers.map((p) => (
                    <MainCard key={p.id} player={p} onRemove={() => togglePlayer(p.id)} />
                  ))}
                  {/* Empty slot placeholders */}
                  {mainCount < 11 && Array.from({ length: 11 - mainCount }).map((_, i) => (
                    <div key={`empty-${i}`} className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/8 bg-transparent py-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-white/10">
                        <span className="text-xs text-gray-700">+</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Squad ────────────────────────────────────────────────────── */}
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Your Squad</h2>
                <span className="text-xs text-gray-600">· Score legend:</span>
                {[
                  { label: '55+ Elite', cls: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' },
                  { label: '38+ Good',  cls: 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40'         },
                  { label: '22+ Avg',   cls: 'bg-white/8 text-gray-300 ring-1 ring-white/10'                },
                ].map((t) => (
                  <span key={t.label} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.cls}`}>{t.label}</span>
                ))}
              </div>

              {POSITION_SECTIONS.map(({ group, label }) => {
                const groupPlayers = players
                  .filter((p) => effectivePositionGroup(p) === group)
                  .sort((a, b) => {
                    const rank = (p: EnrichedPlayer) =>
                      mainIds.has(p.id) ? 0 :
                      isBlocked(p) ? 3 :
                      (p.availabilityPct ?? 100) < 100 ? 2 : 1;
                    const rd = rank(a) - rank(b);
                    if (rd !== 0) return rd;
                    return b.scoreBreakdown.total - a.scoreBreakdown.total;
                  });
                if (!groupPlayers.length) return null;

                return (
                  <div key={group}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {label} <span className="text-gray-700">({groupPlayers.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {groupPlayers.map((player) => (
                        <SquadRow
                          key={player.id}
                          player={player}
                          isMain={mainIds.has(player.id)}
                          onToggle={() => togglePlayer(player.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

          </div>
        )}
      </div>
    </main>
    </>
  );
}
