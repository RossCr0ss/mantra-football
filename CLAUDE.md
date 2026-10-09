# Mantra Football — Claude Code Instructions

Fantasy-football assistant for the Mantra format (26-man squad → 11+9 matchday tour). Data: FotMob (unofficial) + mantrafootball.org, cached in MongoDB.

## Commands (yarn v1 only — never npm/pnpm)
| Task | Command |
|---|---|
| Install | `yarn install` |
| Add dep | `yarn workspace @mantra-football/web add <pkg>` |
| Dev (port 3001) | `yarn dev` |
| **Fast verify after edits (~2 s)** | `yarn typecheck` — run this instead of `yarn build` |
| Unit tests (vitest, ~1 s) | `yarn workspace @mantra-football/web test` — covers `tourScoring`, `tourModules`, `nameMatch`, `buildTeamFixtures` |
| Full build (slow, only before finishing big changes) | `yarn build` |
| MongoDB only | `docker compose up mongo -d` (host port **27028**) |
| Full stack | `docker compose up --build` (web on host 3002 → container 3001) |

Verification loop: `yarn typecheck` + unit tests + `yarn lint` (`next/core-web-vitals`; `next build` fails on lint errors). When you change scoring/formation/matching/difficulty logic, run the tests and extend them (`*.test.ts` next to the module, factories in `lib/testUtils.ts`).

## Layout (Turborepo)
- `apps/web` — Next.js 14 App Router. Source in `apps/web/src/{app,components,lib,store,types}`.
- `packages/shared` — shared types.
- `docs/` — deep reference. **Read only the doc you need:**

| Topic | Doc |
|---|---|
| System overview, collections, design decisions | `docs/architecture.md` |
| FotMob endpoints, shapes, quirks | `docs/fotmob-api.md` |
| mantrafootball.org endpoints | `docs/mantrafootball-api.md` |
| Cache layers / TTLs | `docs/cache.md` |
| Tour scoring algorithm | `docs/scoring.md` (how the weights were fitted / re-fit: `docs/scoring-research.md`) |
| Mantra positions + formations | `docs/mantra-rules.md` |
| injured/suspended/availability model | `docs/player-availability.md` |
| Recipes: new stat / league / feature | `docs/adding-a-feature.md`, `docs/adding-a-league.md` |

## Scoped instructions (auto-loaded when you work in that directory)
- `apps/web/src/lib/CLAUDE.md` — data layer: FotMob/Mantra wrappers, caches, shared client-safe helpers, API quirks.
- `apps/web/src/app/api/CLAUDE.md` — route table + route conventions.
- `apps/web/src/components/CLAUDE.md` — components, state, UI conventions.
- `apps/web/src/app/league/[id]/tour/CLAUDE.md` — tour rules, scoring/modules pointers, difficulty scale.

## Hard rules
- **All FotMob fetches live in `lib/fotmob/*`** (barrel `lib/fotmob.ts`); API routes call the `*Cached` wrappers in `lib/fotmobCache.ts` (MongoDB SWR). Never fetch FotMob URLs from components/routes.
- MongoDB: always `getDb()` from `lib/mongodb.ts`, db `mantra-football`.
- **(enforced by ESLint) Client components must not import `lib/fotmob.ts`, `lib/mongodb.ts`, `lib/injuries.ts`, `lib/suspensionCheck.ts`** (server/heavy). Use the client-safe modules in `lib/` (see `lib/CLAUDE.md`): `leagues`, `positionGroups`, `clientCache`, `injuryDate`, `fixtureDifficulty`.
- **Before adding a helper/constant, grep `apps/web/src/lib` for it** — position groups, league list, difficulty styles, session cache, injury-date check already exist; don't re-declare them in pages.
- TypeScript strict. Use `Array.from()` for Set/Map iteration (target requires it).
- Tailwind only — no CSS modules, no inline `style` unless unavoidable.
- Server components by default; `'use client'` only for state/browser APIs.
- No `public/` dir (Dockerfile doesn't copy it).
- No env vars for mantrafootball credentials — session lives in the `mantra_session` httpOnly cookie.
- After changing behavior, update the matching doc / scoped CLAUDE.md in the same change (stale docs cost more than no docs).

## Supported leagues
Defined in `apps/web/src/lib/leagues.ts` (47 Premier League, 55 Serie A, 40 Belgium, 441 Ukraine, 87 LaLiga). Each entry carries its `mantraTournamentId` (`MANTRA_TOURNAMENT_ID` in `lib/mantraFootball.ts` is derived from it). Adding a league = one entry in `leagues.ts` — see `docs/adding-a-league.md`.

## Known large files (read by range, not whole)
`components/TeamSquadView.tsx` (~520), `components/SquadManager.tsx` (~440), `lib/fotmobCache.ts` (~300), `app/league/[id]/{tour,analytics}/page.tsx` (~450 each; UI pieces in `components/{tour,analytics,team}/`, tour logic in `lib/tourScoring.ts` + `lib/tourModules.ts`). Refactor backlog: `docs/refactor-backlog.md`.
