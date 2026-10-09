# components/ + pages — UI conventions

## Server vs client
| Path | Pattern |
|---|---|
| `/` , `/league/[id]` | Server (squad builder renders `SquadManager`) |
| `/league/[id]/team` | Server → `TeamSquadView` (client); injuries pre-fetched server-side |
| `/league/[id]/injuries` | Server → `InjuryReportView` (client); injuries lazy-refreshed on demand |
| `/league/[id]/analytics`, `/fixtures`, `/tour` | Full client; data via `fetchJsonCached` from `lib/clientCache.ts` (don't hand-roll sessionStorage + fetch) |

Odds are fetched lazily per match (click "Odds") — don't fetch N×5 on load.

## Components
`SquadManager` (builder: team/position filter, pagination, mantrafootball login+import), `TeamSquadView` (position-grouped cards, INJ/SUS toggles, availability 0/50/75/100, position editor, "Sync positions from MantraFootball"), `InjuryReportView`, `LeagueCard`, `LeagueNav` (tabs), `Breadcrumbs`, `BackButton`, `LoadingProgressBar` (`ProgressBar`).

## Feature subfolders
- `components/tour/` — `PitchView` (formation pitch), `TourCards` (`MainCard`, `SquadRow`, `StatBadge`, `TourSkeleton`), `tourUi.ts` (`scoreTier`, `formatDate`, `GROUP_COLORS`).
- `components/analytics/` — `AnalyticsCard`, `RadarChart`, `FormWidgets` (`FormDot`/`FormStrip`/`RecentMatchesList`), `AnalyticsParts` (`SummaryCard`/`EmptyState`/`AnalyticsSkeleton`), `analyticsUi.ts` (`SortKey`, radar config, colour helpers).
- `components/team/PlayerCard.tsx` — `PlayerCard`, `SectionHeader`, `PlayerForm` type (used by `TeamSquadView`).
New pieces of a big page go into the matching subfolder, not back into `page.tsx`.

## Rules
- Import shared UI/domain constants from `lib/` (`positionGroups`, `fixtureDifficulty`, `leagues`, `mantraPositions`) — do not re-declare `POSITION_SECTIONS`, `POSITION_ORDER`, ring/badge maps, difficulty styles, `isToday`, session-cache helpers.
- Never import `lib/fotmob.ts` runtime values into client code except `fetchMatchOddsClient`; types are fine (`import type`).
- Zustand store `store/squadStore.ts` is only for the squad-builder flow; `setLeagueId` resets squad to avoid cross-league mixing. Saved squad is read from MongoDB.
- Team logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png` (`next/image`, `unoptimized`, wrapper `relative h-3.5 w-3.5`).
- Player availability model: `lineupStatus` (`injured|suspended` → blocked from auto-select) and `availabilityPct` (multiplies score); persisted via `PATCH /api/squad`. See `docs/player-availability.md`.
- Tailwind only; Tailwind classes must be literal strings (no dynamic class concatenation).
