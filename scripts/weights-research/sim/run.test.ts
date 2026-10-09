// Simulation harness: runs the REAL calcScore() + pickBestModule() of the engine in SRC over random squads.
// Driven by sim/run_sim.sh (env: SRC ROWS SQUADS OUT SCORES_OUT AVAIL WEIGHTS_JSON SIM_MODE).
import fs from 'node:fs';
import * as scoring from '@/lib/tourScoring';
const calcScore: any = scoring.calcScore;
const computeTeamForm: any = (scoring as any).computeTeamForm;   // removed in the new engine
import { pickBestModule, MODULES, defenderSlotIndexes, defenceBonusPoints, type EnrichedPlayer } from '@/lib/tourModules';

const ROWS = process.env.ROWS!;
const SQUADS = process.env.SQUADS!;
const OUT = process.env.OUT!;
const AVAIL = process.env.AVAIL ?? 'none';   // none | sugg
const MODE = process.env.SIM_MODE ?? 'engine';   // engine | oracle | random
const WEIGHTS_OVERRIDE = process.env.WEIGHTS_JSON ? JSON.parse(fs.readFileSync(process.env.WEIGHTS_JSON, 'utf8')) : null;

function toAnalytics(r: any) {
  const s = r.analytics ?? {};
  return {
    playerId: r.rid, name: 'p' + r.rid, teamName: '', teamId: r.team, position: '', positionGroup: r.group, imageUrl: '', mantraPositions: r.nat,
    rating: s.rating ?? null, goals: s.goals ?? 0, assists: s.assists ?? 0, yellowCards: 0, redCards: 0, leagueRank: null,
    matchesPlayed: s.matchesPlayed ?? 0, minutesPlayed: s.minutesPlayed ?? 0, cleanSheets: s.cleanSheets ?? 0, saves: s.saves ?? 0,
    goalsConceded: s.goalsConceded ?? 0, savePercentage: null, goalsPrevented: null, penaltySaves: null, actedSweeper: null, highClaims: null,
    errorLeadToGoal: null, tackles: s.tackles ?? null, interceptions: s.interceptions ?? null, clearances: s.clearances ?? null,
    blockedShots: s.blockedShots ?? null, aerialsWon: null, foulsCommitted: s.foulsCommitted ?? null, possessionWonFinal3rd: null,
    dribbledPast: null, expectedGoals: s.expectedGoals ?? null, shots: s.shots ?? null, chancesCreated: s.chancesCreated ?? null,
    successfulDribbles: null, bigChancesCreated: s.bigChancesCreated ?? null, bigChancesMissed: s.bigChancesMissed ?? null,
    priorSeason: r.prior ? { ...r.prior, savePercentage: null, goalsPrevented: null, highClaims: null } : null,
  } as any;
}

test('simulate squads', async () => {
  if (WEIGHTS_OVERRIDE) {
    const mod: any = await import('@/lib/tourScoring');
    if (mod.SCORE_WEIGHTS) deepMerge(mod.SCORE_WEIGHTS, WEIGHTS_OVERRIDE);
  }
  const rows: any[] = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
  const squads: any[] = JSON.parse(fs.readFileSync(SQUADS, 'utf8'));
  const byRid = new Map<number, any>(rows.map((r) => [r.rid, r]));
  const enriched = new Map<number, EnrichedPlayer>();
  const need = new Set<number>(); for (const s of squads) for (const id of s.rids) need.add(id);
  const scoresOut: Record<number, any> = {};
  need.forEach((rid) => {
    const r = byRid.get(rid)!;
    const fix: any = {
      matchId: 'm' + r.mid, date: r.date, round: r.fixture.round, homeTeam: { id: r.team, name: '', logoUrl: '' }, awayTeam: { id: r.fixture.oppId, name: '', logoUrl: '' },
      finished: false, homeScore: null, awayScore: null, isHome: r.fixture.isHome, opponent: { id: r.fixture.oppId, name: '', logoUrl: '' },
      difficulty: r.fixture.difficulty, odds: null,
    };
    const player: any = { id: rid, name: 'p' + rid, teamId: r.team, teamName: '', position: '', positionGroup: r.group, imageUrl: '', mantraPositions: r.nat };
    if (AVAIL === 'sugg' && r.sugg != null) { player.availabilityPct = r.sugg; player.availabilityPctSource = 'suggested'; }
    if (AVAIL === 'oracle') { player.availabilityPct = r.started ? 100 : 0; player.availabilityPctSource = 'manual'; }
    const analytics = toAnalytics(r);
    const tf = computeTeamForm ? computeTeamForm(r.form) : undefined;
    let sb = calcScore(player, analytics, fix, r.odds, r.form, tf);
    if (MODE === 'oracle') {
      const v = r.played && r.pts != null ? Math.max(0.01, (r.pts - 5) * 15) : 0.01;
      sb = { ...sb, total: v, rating: v, baseRating: r.base ?? 6, availability: 100 };
    } else if (MODE === 'random') {
      const v = 5 + Math.random() * 50;
      sb = { ...sb, total: v, rating: v, availability: 100 };
    }
    enriched.set(rid, { ...player, nextFixture: fix, analytics, odds: r.odds, scoreBreakdown: sb });
    scoresOut[rid] = sb;
  });

  const results: any[] = [];
  for (const sq of squads) {
    const avail = sq.rids.map((id: number) => enriched.get(id)!).filter((p) => p.scoreBreakdown.total > -900);
    const best = pickBestModule(avail);
    if (!best) { results.push({ ok: false }); continue; }
    const mod = MODULES.find((m) => m.name === best.moduleName)!;
    const ids = best.assignment.ids;
    let sum = 0; let played = 0;
    ids.forEach((id: number, i: number) => {
      const r = byRid.get(id)!;
      if (r.played && r.pts != null) { sum += r.pts + (best.assignment.penalty[i] ?? 0); played++; }
    });
    const defIdx = defenderSlotIndexes(mod.slots);
    const defBase = defIdx.length ? defIdx.reduce((a, i) => { const r = byRid.get(ids[i + 1])!; return a + (r.played && r.base != null ? r.base : 0); }, 0) / defIdx.length : 0;
    const defBonus = defenceBonusPoints(defBase);
    results.push({ ok: true, key: sq.key, scenario: sq.scenario, module: best.moduleName, sum, defBonus, total: sum + defBonus, played, ids });
  }
  fs.writeFileSync(OUT, JSON.stringify({ results }));
  if (process.env.SCORES_OUT) fs.writeFileSync(process.env.SCORES_OUT, JSON.stringify(scoresOut));
});

function deepMerge(t: any, s: any) { for (const k of Object.keys(s)) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) { t[k] = t[k] ?? {}; deepMerge(t[k], s[k]); } else t[k] = s[k]; } }
