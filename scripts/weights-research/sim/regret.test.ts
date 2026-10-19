// Simulation harness: runs the REAL calcScore() + pickBestModule() of the engine in SRC over random squads.
// Driven by sim/run_sim.sh (env: SRC ROWS SQUADS OUT SCORES_OUT AVAIL WEIGHTS_JSON SIM_MODE).
import fs from 'node:fs';
import * as scoring from '@/lib/tourScoring';
const calcScore: any = scoring.calcScore;
const computeTeamForm: any = (scoring as any).computeTeamForm;   // removed in the new engine
import { pickBestModule, assignModule, improveAssignment, assignmentScore, MODULES, defenderSlotIndexes, defenceBonusPoints, type EnrichedPlayer } from '@/lib/tourModules';

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

test('regret decomposition', async () => {
  if (WEIGHTS_OVERRIDE) {
    const mod: any = await import('@/lib/tourScoring');
    if (mod.SCORE_WEIGHTS) deepMerge(mod.SCORE_WEIGHTS, WEIGHTS_OVERRIDE);
  }
  const rows: any[] = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
  const squads: any[] = JSON.parse(fs.readFileSync(SQUADS, 'utf8'));
  const byRid = new Map<number, any>(rows.map((r) => [r.rid, r]));
  const enriched = new Map<number, EnrichedPlayer>();
  const oracle = new Map<number, EnrichedPlayer>();
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
    const ov = r.played && r.pts != null ? Math.max(0.01, (r.pts - 5) * 15) : 0.01;
    oracle.set(rid, { ...player, nextFixture: fix, analytics, odds: r.odds, scoreBreakdown: { ...sb, total: ov, startProb: 1, baseRating: r.base ?? 6 } });
    scoresOut[rid] = sb;
  });

  // realised points of an assignment in a module: played players' points + malus + defence bonus (real base ratings)
  const realised = (ids: number[], penalty: number[], slots: any) => {
    let sum = 0;
    ids.forEach((id: number, i: number) => { const r = byRid.get(id)!; if (r.played && r.pts != null) sum += r.pts + (penalty[i] ?? 0); });
    const defIdx = defenderSlotIndexes(slots);
    const defBase = defIdx.length ? defIdx.reduce((a: number, i: number) => { const r = byRid.get(ids[i + 1])!; return a + (r.played && r.base != null ? r.base : 0); }, 0) / defIdx.length : 0;
    return sum + defenceBonusPoints(defBase);
  };
  const results: any[] = [];
  for (const sq of squads) {
    const row: any = { key: sq.key, scenario: sq.scenario, eng: {}, orc: {}, engScore: {}, engAssign: {} };
    for (const [label, pool, store] of [['eng', enriched, row.eng], ['orc', oracle, row.orc]] as const) {
      const avail = sq.rids.map((id: number) => pool.get(id)!).filter((p) => p.scoreBreakdown.total > -900);
      const byId = new Map(avail.map((p) => [p.id, p]));
      for (const mod of MODULES) {
        const g = assignModule(avail, mod.slots);
        if (!g) continue;
        const a = improveAssignment(g, avail, mod.slots);
        (store as any)[mod.name] = realised(a.ids, a.penalty, mod.slots);
        if (label === 'eng') { row.engScore[mod.name] = assignmentScore(a, byId, mod.slots); row.engAssign[mod.name] = a.ids; }
      }
    }
    results.push(row);
  }
  fs.writeFileSync(OUT, JSON.stringify({ results }));
});

function deepMerge(t: any, s: any) { for (const k of Object.keys(s)) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) { t[k] = t[k] ?? {}; deepMerge(t[k], s[k]); } else t[k] = s[k]; } }
