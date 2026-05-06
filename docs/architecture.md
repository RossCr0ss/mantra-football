# Architecture

## What this app does

Mantra Football is a fantasy football manager assistant for the Italian **Mantra** league format. Users build a squad of 26 players from a real league, then use the app to:

- Track player injuries and availability
- View upcoming fixtures with difficulty ratings and betting odds
- See season analytics (rating, goals, clean sheets, xG, etc.)
- Select a matchday lineup (11 main + 9 subs) using an auto-scoring algorithm

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Server components for SSR data fetching; client components only where state/interactivity needed |
| Styling | Tailwind CSS | No build step, consistent design tokens |
| State | Zustand | Lightweight; only used for squad builder cross-component state |
| Database | MongoDB (Docker) | JSON-native storage; flexible schema for cached API responses |
| Data source | FotMob (unofficial API) | Rich player/team/match data with no API key required |
| Monorepo | Turborepo + Yarn workspaces | `apps/web` + `packages/shared` separation |

## Directory layout

```
mantra-football/
├── apps/web/src/
│   ├── app/                    # Next.js App Router pages + API routes
│   │   ├── api/
│   │   │   ├── leagues/[id]/analytics/   # Season stats for squad players
│   │   │   ├── leagues/[id]/fixtures/    # Upcoming fixtures + difficulty
│   │   │   ├── leagues/[id]/teams/       # All teams in a league
│   │   │   ├── matches/[id]/odds/        # 1×2 betting odds
│   │   │   ├── players/[id]/injury/      # Injury info + overrides
│   │   │   └── squad/                   # Squad CRUD
│   │   ├── league/[id]/
│   │   │   ├── page.tsx                 # Squad builder
│   │   │   ├── team/                    # Squad view + status controls
│   │   │   ├── injuries/                # Injury dashboard
│   │   │   ├── analytics/               # Stats table
│   │   │   ├── fixtures/                # Fixture list
│   │   │   └── tour/                    # Matchday selector
│   │   └── page.tsx                     # League selector home
│   ├── components/             # Shared React components
│   ├── lib/
│   │   ├── fotmob.ts           # FotMob API — ALL external fetches live here
│   │   ├── fotmobCache.ts      # MongoDB-backed wrappers for fotmob.ts functions
│   │   ├── mongoCache.ts       # Generic TTL cache utility (withCache)
│   │   ├── fixturesCache.ts    # Fixtures + table positions cache (separate from mongoCache)
│   │   ├── injuries.ts         # DB override → FotMob fallback for injury info
│   │   ├── mantraPositions.ts  # Position definitions + FotMob label → Mantra position mapping
│   │   └── mongodb.ts          # MongoDB client (getDb singleton)
│   ├── store/
│   │   └── squadStore.ts       # Zustand store for squad builder
│   └── types/
│       └── squad.ts            # Core domain types (SquadPlayer, MantraPosition, etc.)
├── packages/shared/            # Shared types (currently minimal)
├── docs/                       # This directory — design docs
├── CLAUDE.md                   # Claude Code instructions (keep up to date)
├── docker-compose.yml
└── turbo.json
```

## Data flow

```
FotMob API (unofficial)
        │
        ▼
  fotmob.ts           ← Single module, all external HTTP calls
        │
        ▼
  fotmobCache.ts      ← MongoDB TTL wrappers (6h players, 24h teams, 30m odds)
  fixturesCache.ts    ← Fixtures + table positions (1h TTL, separate collection)
        │
        ▼
  API routes          ← Next.js route handlers assemble + enrich data
        │
        ▼
  Page components     ← Server components (SSR) or client components (fetch on mount)
        │
        ▼
  MongoDB `squads`    ← Persistent squad, lineupStatus, availabilityPct per player
```

## Key design decisions

### Why one FotMob call for all fixtures?
Previously each team needed its own API call to get fixtures. `fetchLeagueData` was introduced to fetch the full season schedule in a single request (`/api/data/leagues?id=...`), then filter per team client-side. One call covers all 26 squad players regardless of how many teams they play for.

### Why MongoDB for caching instead of Redis?
MongoDB is already required for squad persistence. Adding a Redis instance would increase infra complexity with no benefit at this scale. `mongoCache.ts` provides the same TTL semantics.

### Why server components by default?
FotMob data can be pre-fetched on the server, cutting initial load time and eliminating client-side waterfall. Client components are added only where browser APIs or interactive state are needed (SquadManager, TeamSquadView, tour page, etc.).

### Why is there a separate `fixturesCache.ts` and not just `withCache`?
Fixtures need to cache a `Map<number, number>` (table positions). MongoDB can't store Maps, so `fixturesCache.ts` handles the serialisation to `Record<string, number>` manually. `withCache` handles this for arrays/objects but the fixture cache predates the generic utility and has different invalidation logic (1h TTL, leagueId key).

### Why does the squad store exist if squads are in MongoDB?
The Zustand store (`squadStore.ts`) is used only during the **squad builder** flow (`/league/[id]`). It holds the in-progress selection before the user saves. Once saved, the team page and all other pages read directly from MongoDB. `setLeagueId` resets squad state to prevent cross-league player mixing.

### Server vs client for each page

| Page | Pattern | Reason |
|---|---|---|
| `/league/[id]/team` | Server → `TeamSquadView` client | Pre-fetch injuries server-side; client handles status toggles |
| `/league/[id]/injuries` | Server → `InjuryReportView` client | Pre-fetch all injuries in parallel server-side |
| `/league/[id]/analytics` | Full client | All data loaded via fetch on mount; sortable table + card view with per-position radar chart |
| `/league/[id]/fixtures` | Full client | Odds fetched lazily per match on user action |
| `/league/[id]/tour` | Full client | Complex scoring state; odds needed after initial load |

## UI conventions

### Team logo URLs

Every `SquadPlayer` and `PlayerAnalytics` has a `teamId`. Team emblem images are derived on the fly — no extra field needed:

```typescript
`https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`
```

All player-facing cards and rows display the team emblem next to the team name. The pattern used everywhere:

```tsx
<div className="relative h-3.5 w-3.5 shrink-0">
  <Image src={`https://images.fotmob.com/image_resources/logo/teamlogo/${player.teamId}.png`}
         alt="" fill className="object-contain" unoptimized />
</div>
```

On the pitch view (tour page) the emblem appears as a small badge overlaid on the bottom-right of the player avatar, inside a `relative` wrapper around the avatar `div`.

### Pitch view sizing

The tactics view in `tour/page.tsx` uses `max-w-sm sm:max-w-xl md:max-w-2xl` so the pitch scales up on wider screens while staying readable on mobile. Player token sizes are:
- GK avatar: `h-12 w-12`
- Outfield avatar: `h-11 w-11`
- Score chip: `text-[9px]`
- Name pill: `text-[9px]`, `max-w-[80px]`

---

## MongoDB collections

| Collection | Key | Purpose |
|---|---|---|
| `squads` | `leagueId` | User squad (players, mantraPositions, lineupStatus, availabilityPct) |
| `player_injuries` | `playerId` | Manual injury overrides; `cleared: true` suppresses FotMob data |
| `fotmob_teams` | `leagueId` | Cached FotMob team list (24h TTL) |
| `fotmob_players` | `teamId` | Cached squad + basic stats (6h TTL) |
| `fotmob_stats` | `teamId` | Cached Map<playerId, PlayerSeasonStats> serialised as array (6h TTL) |
| `fotmob_ratings` | `leagueId, seasonId` | Cached league rating rankings (24h TTL) |
| `fotmob_all_stats` | `leagueId, seasonId` | All 19 CDN stat categories merged into one doc per league-season (24h TTL) |
| `fotmob_stat_list` | `leagueId, seasonId, statKey` | Single stat list per key — available for ad-hoc use (24h TTL) |
| `fotmob_season` | `leagueId` | Cached primary season ID (24h TTL) |
| `fotmob_odds` | `matchId` | Cached 1×2 odds (30m TTL) |
| `fixtures_cache` | `leagueId` | League matches + table positions (1h TTL) |
