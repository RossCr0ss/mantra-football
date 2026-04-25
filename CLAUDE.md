# Mantra Football — Claude Code Instructions

## Package manager
Always use **yarn** (v1 classic). Never use `npm` or `pnpm`. Lock file is `yarn.lock`.
- Install deps: `yarn install`
- Add a package: `yarn workspace @mantra-football/web add <pkg>`
- Run dev: `yarn dev`
- Build: `yarn build`

## Project structure
Turborepo monorepo:
- `apps/web` — Next.js 14 app (App Router)
- `packages/shared` — shared types (`@mantra-football/shared`)

See `docs/architecture.md` for the full system overview and design decisions.

## Docker
- MongoDB is on host port **27028** (not 27017) to avoid conflicting with a local MongoDB instance.
- Inside Docker the web service connects to mongo via `mongodb://mongo:27017/mantra-football` (internal network).
- Start only MongoDB for local dev: `docker compose up mongo -d`
- Full stack: `docker compose up --build`
- `apps/web` has **no `public/` directory** — do not add COPY steps for it in the Dockerfile.

## Data layer
- MongoDB client: `apps/web/src/lib/mongodb.ts` — always use `getDb()`, database name is `mantra-football`.
- FotMob API wrapper: `apps/web/src/lib/fotmob.ts` — **all FotMob fetches go through here**, never call FotMob URLs directly from components or API routes.
- MongoDB TTL cache: `apps/web/src/lib/mongoCache.ts` + `apps/web/src/lib/fotmobCache.ts` — wrap all expensive FotMob calls. See `docs/cache.md`.
- Fixtures cache: `apps/web/src/lib/fixturesCache.ts` — separate cache with 1-hour TTL for league matches + table positions.
- Injury overrides are stored in the `player_injuries` MongoDB collection (keyed by `playerId`). Use `getPlayerInjury()` from `apps/web/src/lib/injuries.ts` — it prefers DB overrides over live FotMob data.

See `docs/fotmob-api.md` for all FotMob endpoint shapes and known quirks.

## FotMob API functions (apps/web/src/lib/fotmob.ts)
| Function | Description |
|---|---|
| `fetchLeagueTeams(leagueId)` | All teams in a league (from league table) |
| `fetchTeamPlayers(teamId, teamName)` | Squad members with season stats; falls back to `fetchTeamPlayersFromLineup` when `squad.squad` is null |
| `fetchTeamPlayerStats(teamId, teamName)` | Map of playerId → stats (wraps `fetchTeamPlayers`) |
| `fetchLeagueRatingStats(leagueId, seasonId)` | League-wide rating ranking (gzipped static JSON from data.fotmob.com) |
| `fetchLeagueStatsList(leagueId, seasonId, statKey)` | Single stat list from data.fotmob.com (cleansheet, saves, expectedgoals, shots, keypasses) |
| `fetchLeagueSeasonId(leagueId)` | Primary season ID for a league |
| `fetchPlayerInjuryInfo(playerId)` | Live injury info from FotMob playerData endpoint |
| `fetchLeagueData(leagueId)` | **Single call** → `{ tablePositions: Map<teamId,pos>, matches: LeagueMatch[], currentRound }`. Replaces per-team fixture fetching. |
| `fetchMatchOdds(matchId)` | 1×2 decimal odds — server-side only, uses `FOTMOB_CCODE3` + `FOTMOB_BETTING_PROVIDER` env vars |
| `fetchMatchOddsClient(matchId)` | Client-side proxy caller → hits `/api/matches/[id]/odds` |

### FotMob endpoints used internally
- `https://www.fotmob.com/api/data/leagues?id={id}` — league table (`data.table`) + all season matches (`data.fixtures.allMatches`); used by `fetchLeagueTeams` and `fetchLeagueData`
- `https://www.fotmob.com/api/data/teams?id={id}` — squad, season stats, primarySeasonId; used by `fetchTeamPlayers`
- `https://www.fotmob.com/api/playerData?id={id}` — player injury info (injuryInformation field)
- `https://www.fotmob.com/api/data/matchOdds?matchId={id}&ccode3={ccode3}&bettingProvider={provider}` — 1×2 odds; requires country code + provider name
- `https://data.fotmob.com/stats/{leagueId}/season/{seasonId}/rating.json` — gzipped league rating stats
- `https://data.fotmob.com/stats/{leagueId}/season/{seasonId}/{statKey}.json` — stat-specific lists

**Critical quirks** — see `docs/fotmob-api.md` for full details:
- Matches are at `data.fixtures.allMatches` NOT `data.matches`
- `home.id` / `away.id` are **strings** — always parse with `Number()`
- Belgian Pro League has split table structure (`data.tables[].table.all`)
- Ukrainian clubs outside Shakhtar/Dynamo have `squad.squad = null` — fallback uses `overview.lastLineupStats`
- Odds require geo params (server-side); Ukrainian users use `ccode3=UKR&bettingProvider=22Bet_Ukraine`
- `data.fotmob.com/stats/441/...rating.json` returns 403 for Ukrainian league (only goals.json accessible)

## Supported leagues (LEAGUES constant in fotmob.ts)
| ID | Name | Country |
|---|---|---|
| 47 | Premier League | England |
| 55 | Serie A | Italy |
| 40 | First Division A (Jupiler Pro League) | Belgium |
| 441 | Ukrainian Premier League | Ukraine |
| 87 | LaLiga | Spain |

**LaLiga note:** After round 30, playoff rounds reset to roundName 1, 2… — `buildTeamFixtures` filters `!m.finished` to avoid collisions with regular-season round 1.

## API routes (Next.js App Router)
All under `apps/web/src/app/api/`:

| Route | Method | Description |
|---|---|---|
| `/api/leagues/[id]/teams` | GET | League teams from FotMob |
| `/api/leagues/[id]/analytics` | GET | Season stats for all saved squad players (parallel team fetches + league stat lists) |
| `/api/leagues/[id]/fixtures` | GET | Upcoming fixture for every team in the squad (uses `fixturesCache`) |
| `/api/teams/[id]/players` | GET | Team squad from FotMob (`?teamName=` required) |
| `/api/matches/[id]/odds` | GET | 1×2 decimal odds for a match (MongoDB-cached, 30 min TTL) |
| `/api/squad` | GET | Read saved squad from MongoDB (`?leagueId=`) |
| `/api/squad` | POST | Save/replace full squad in MongoDB |
| `/api/squad` | PATCH | Update single-player fields: `mantraPositions`, `lineupStatus`, `availabilityPct` |
| `/api/players/[id]/injury` | GET | Injury info (DB override → FotMob fallback) |
| `/api/players/[id]/injury` | PUT | Manually override injury info in MongoDB (pass `{cleared: true}` to mark healed) |
| `/api/players/[id]/injury` | DELETE | Delete DB override; returns current live FotMob data |

## Pages (apps/web/src/app/)
| Path | Component | Server/Client | Description |
|---|---|---|---|
| `/` | `page.tsx` | Server | League selector home |
| `/league/[id]` | `page.tsx` | Server | Squad builder (redirects to `/team` if squad exists) |
| `/league/[id]/team` | `page.tsx` | Server | Squad view: injury toggles, availability %, position editor |
| `/league/[id]/injuries` | `page.tsx` | Server → `InjuryReportView` | Injury dashboard: all players with injury/suspension/availability issues |
| `/league/[id]/analytics` | `page.tsx` | Client | Season stats table, sortable columns |
| `/league/[id]/fixtures` | `page.tsx` | Client | Upcoming fixtures; difficulty badges; on-demand odds |
| `/league/[id]/tour` | `page.tsx` | Client | Tour squad selector: 11 main + 9 subs, auto-select by scoring algorithm |

## Types
| Type | Location | Purpose |
|---|---|---|
| `SquadPlayer` | `apps/web/src/types/squad.ts` | Player in saved squad with Mantra positions, status, availability |
| `Squad` | `apps/web/src/types/squad.ts` | Saved squad document (leagueId, players, updatedAt) |
| `SQUAD_RULES` | `apps/web/src/types/squad.ts` | Constraints: 26 total, 3 GK |
| `TourSelection` | `apps/web/src/types/squad.ts` | 11 main + 9 subs for a matchday tour |
| `LineupStatus` | `apps/web/src/types/squad.ts` | `'injured' \| 'suspended'` — blocks player from auto-select |
| `MantraPosition` | `apps/web/src/types/squad.ts` | GK, RB, CB, LB, WB, DM, CM, W, AM, FW, ST |
| `PositionGroup` | `apps/web/src/types/squad.ts` | GK, DEF, MID, FWD |
| `FotMobPlayer` | `apps/web/src/lib/fotmob.ts` | Player with season stats from FotMob |
| `FotMobTeam` | `apps/web/src/lib/fotmob.ts` | Team with logo URL |
| `PlayerInjuryInfo` | `apps/web/src/lib/fotmob.ts` | Injury name, expected return, override flag |
| `LeagueMatch` | `apps/web/src/lib/fotmob.ts` | Raw match from `data.fixtures.allMatches` |
| `TeamFixture` | `apps/web/src/lib/fotmob.ts` | `LeagueMatch` + isHome, opponent, difficulty 1–5, odds |
| `FixtureOdds` | `apps/web/src/lib/fotmob.ts` | home / draw / away decimal odds |
| `PlayerSeasonStats` | `apps/web/src/lib/fotmob.ts` | Rating, goals, assists, cards, plus GK (cleanSheets, saves) and MID/FWD (xG, shots, chancesCreated) stats |
| `PlayerAnalytics` | `apps/web/src/app/api/leagues/[id]/analytics/route.ts` | PlayerSeasonStats + name, team, position, image |

### Key SquadPlayer fields
```typescript
interface SquadPlayer {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
  position: string;           // FotMob label, e.g. "CB", "CAM"
  positionGroup: PositionGroup;
  imageUrl: string;
  mantraPositions: MantraPosition[];
  lineupStatus?: LineupStatus; // 'injured' | 'suspended' — blocks auto-select
  availabilityPct?: number;    // 0–100, default 100 (full starter). Multiplies tour score.
}
```

## Squad rules
Defined in `SQUAD_RULES` (`apps/web/src/types/squad.ts`):
- Total **26 players**
- Exactly **3 goalkeepers**

## Tour rules (Mantra matchday selection)
From `TourSelection` (`apps/web/src/types/squad.ts`):
- **11 main players**: exactly 1 GK + 10 outfield
- **9 substitutes**: min 1 GK required on bench
- Selected from the saved 26-player squad
- Auto-select scores players by multi-factor algorithm (see `docs/scoring.md`)
- `lineupStatus === 'injured' | 'suspended'` → excluded from auto-select
- `availabilityPct` multiplies the final score (0% → score 0, never auto-selected)

## Fixture difficulty scale
Computed in `buildTeamFixtures` (`fixturesCache.ts`) based on opponent's league table position:
- **1** = hardest (opponent near top) — shown red
- **2** = hard — shown orange
- **3** = medium — shown yellow
- **4** = moderate — shown light green
- **5** = easiest (opponent near bottom) — shown dark green

Formula: `Math.max(1, Math.min(5, Math.ceil((opponentPosition / totalTeams) * 5)))`, inverted so difficulty 1 = easy, 5 = hard? Wait — re-check. Actually the DIFF_STYLE in tour page has 1=red (hard) and 5=green (easy), but the buildTeamFixtures comment says 1=easy. Need to check the actual formula. The formula gives ceil(pos/total * 5) so position 1 (top) → ceil(1/20 * 5) = 1. So difficulty 1 = TOP team (hardest). The UI shows 1=red, 5=green, which means 1=hard, 5=easy.

## Components
| Component | Location | Notes |
|---|---|---|
| `SquadManager` | `apps/web/src/components/SquadManager.tsx` | Client — squad builder with team/position filter, pagination |
| `TeamSquadView` | `apps/web/src/components/TeamSquadView.tsx` | Client — position-grouped cards; injury/suspension toggles; availability % selector (0/50/75/100); position editor |
| `InjuryReportView` | `apps/web/src/components/InjuryReportView.tsx` | Client — injury dashboard: injured/suspended/doubtful sections with quick-clear actions |
| `LeagueCard` | `apps/web/src/components/LeagueCard.tsx` | Server-safe card for league selection |
| `BackButton` | `apps/web/src/components/BackButton.tsx` | Client — browser back navigation |
| `Breadcrumbs` | `apps/web/src/components/Breadcrumbs.tsx` | Client — breadcrumb nav from URL path |
| `LeagueNav` | `apps/web/src/components/LeagueNav.tsx` | Client — tab nav: My Team / Injuries / Analytics / Fixtures / Tour / Edit Squad |

## State management
- Zustand store: `apps/web/src/store/squadStore.ts`
- State: `{ squad, leagueId, setLeagueId, setSquad, addPlayer, removePlayer }`
- `setLeagueId` resets the squad to prevent cross-league mixing.

## Tour modules (formations)
Each module defines exactly 10 outfield slots (GK is always slot 0). Players are assigned by Mantra position compatibility. See `docs/mantra-rules.md` for the full position/module reference.

| Module | Slots (positions accepted per slot) |
|---|---|
| 3-4-3   | CB, CB, CB, WB, DM/CM, CM, WB, W/FW, FW/ST, W/FW |
| 3-4-1-2 | CB, CB, CB, WB, DM/CM, CM, WB, AM, FW/ST, FW/ST |
| 3-4-2-1 | CB, CB, CB, WB/W, DM, DM/CM, WB, AM, AM/FW, FW/ST |
| 3-5-2   | CB, CB, CB, WB/W, DM, DM/CM, CM, WB, FW/ST, FW/ST |
| 3-5-1-1 | CB, CB, CB, DM, DM, CM, WB/W, AM/FW, WB/W, FW/ST |
| 4-3-3   | RB, CB, CB, LB, DM/CM, CM, DM, W/FW, FW/ST, W/FW |
| 4-3-1-2 | RB, CB, CB, LB, DM/CM, DM, CM, AM, FW/ST, FW/ST |
| 4-4-2   | RB, CB, CB, LB, WB/W, DM/CM, CM, WB, FW/ST, FW/ST |
| 4-1-4-1 | RB, CB, CB, LB, DM, WB/W, CM/AM, AM, W, FW/ST |
| 4-4-1-1 | RB, CB, CB, LB, WB/W, DM, CM, WB/W, AM/FW, FW/ST |
| 4-2-3-1 | RB, CB, CB, LB, DM, DM/CM, W/AM, AM, W/FW, FW/ST |
| 4-3-2-1 | RB, CB, CB, LB, DM/CM, DM, CM, AM/FW, FW/ST, AM/FW |

## Coding conventions
- TypeScript strict mode everywhere. Use `Array.from()` for `Set`/`Map` iteration (not spread `[...set]`) — tsconfig target requires it.
- Tailwind for all styling — no CSS modules, no inline `style` objects unless absolutely necessary.
- Server components by default; add `'use client'` only when state or browser APIs are needed.
- Do not add `public/` folder unless static assets are actually needed — the Dockerfile does not copy it.
- Injury info is fetched lazily in `InjuryReportView` (on demand via refresh); the team page pre-fetches server-side.
- Odds are fetched lazily per match (click "Odds" button in fixtures page) to avoid N×5 FotMob calls on load.
- All new FotMob API functions must live in `fotmob.ts` and use `next: { revalidate: N }` for ISR caching.
- All cached FotMob calls used in API routes must go through `fotmobCache.ts` (MongoDB TTL layer).

## Player availability model
Player readiness for tour selection is controlled by two orthogonal fields on `SquadPlayer`:

| Field | Values | Effect |
|---|---|---|
| `lineupStatus` | `'injured'` or `'suspended'` or `undefined` | Blocks auto-select entirely; shown as dim with INJ/SUS badge |
| `availabilityPct` | 0–100 (default 100) | Multiplies tour score; 50% player scores half → ranks lower |

Set via the status controls in `TeamSquadView` (injury/suspension toggles + 0/50/75/100% buttons) or on the Injuries page quick-actions. Persisted to MongoDB via `PATCH /api/squad`.
