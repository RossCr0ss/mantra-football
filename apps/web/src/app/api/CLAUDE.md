# app/api/ — route handlers

**Conventions (use `lib/apiUtils.ts`, don't hand-roll):** `parseLeagueParam(params.id)` → supported league or `apiError('League not found', 404)`; `parseIdParam(raw)` for player/team/match ids (strict positive int, `null` otherwise → `apiError(..)` 400); `findLeague(id)` when the id comes from query/body. Wrong ids never reach FotMob/Mongo (prevents cache pollution with arbitrary league ids). Read request bodies defensively (malformed JSON → 400, not 500).

Route handlers are thin: parse id → call a `*Cached` function (`lib/fotmobCache.ts`, `fixturesCache.ts`, `mantraFootballCache.ts`, `injuries.ts`) → `NextResponse.json`. Support `?refresh=1` → `forceRefresh` where data is cached.

| Route | Method | Purpose |
|---|---|---|
| `/api/leagues/[id]/teams` | GET | League teams |
| `/api/leagues/[id]/analytics` | GET | Season stats for saved squad (team stats + rating + 19 CDN categories via `getLeagueAllPlayerStatsCached`); exports `PlayerAnalytics` type |
| `/api/leagues/[id]/fixtures` | GET | Upcoming fixture per squad team (`fixturesCache`) |
| `/api/leagues/[id]/form` | GET | Recent matches per squad player |
| `/api/leagues/[id]/injuries` | GET | Active injuries of the saved squad `{ injuries: Record<playerId, PlayerInjuryInfo> }` (override → live FotMob flag; healthy players omitted; "healed" overrides are included with `cleared: true`, so clients must filter with `isInjuryActive`). Used by the tour page via `applyLiveInjuries` |
| `/api/leagues/[id]/suspensions` | GET | Suspension / yellow-card info for squad |
| `/api/leagues/[id]/mantra-positions` | GET | Official Mantra positions for the tournament |
| `/api/leagues/[id]/mantra-import` | POST | Import mantrafootball team by id → matched `SquadPlayer[]` preview (not saved) + unmatched; needs `mantra_session` cookie; 409 if roster is from a past season |
| `/api/mantra-auth/login` | GET / POST / DELETE | auth status / log in (sets httpOnly `mantra_session`, 12 h) / log out |
| `/api/teams/[id]/players` | GET | Team squad (`?teamName=` required) |
| `/api/matches/[id]/odds` | GET | 1×2 odds (cached) |
| `/api/squad` | GET / POST / PATCH | read (`?leagueId=`) / replace / update one player's `mantraPositions`, `lineupStatus`, `availabilityPct` |
| `/api/players/[id]/injury` | GET / PUT / DELETE | injury info (DB override → FotMob) / manual override (`{cleared:true}` = healed) / delete override |
| `/api/players/[id]/stats` | GET | Rich stats w/ percentiles (needs `FOTMOB_COOKIE`) |
| `/api/players/[id]/form` | GET | Recent matches for one player |
| `/api/players/[id]/team` | GET | Player's current club (`?refresh=1`) |

Never call FotMob/mantrafootball URLs directly here — go through `lib/`.
