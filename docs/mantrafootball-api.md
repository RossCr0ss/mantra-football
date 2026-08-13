# MantraFootball.org API Reference

mantrafootball.org is the actual fantasy game this app supports. It's used as the source of truth for `mantraPositions` (replacing the `guessMantraPositions` heuristic) and, once the authenticated flow is confirmed, for importing an existing squad. No API key — standard browser headers only. All calls go through `apps/web/src/lib/mantraFootball.ts`. Never call mantrafootball.org URLs directly from components or API routes; use `mantraFootballCache.ts`'s `get*Cached` wrappers from routes.

## Base URL

`https://mantrafootball.org/api/` — a JSON:API-flavored Rails backend behind a client-rendered React shell. The static HTML shell carries no data; everything loads via these `/api/` calls (confirmed by sniffing network traffic with headless Chromium — the webpack bundle itself doesn't contain readable endpoint strings).

**curl gotcha:** query params use `filter[key]=value` / `page[key]=value` — the square brackets trigger curl's URL-globbing feature. Always pass `-g` to curl, or the request fails with exit code 3.

## Tournament IDs (stable, not seasonal)

| Tournament ID | Country | Our `LEAGUES` id (`fotmob.ts`) |
|---|---|---|
| 1 | Italy | 55 (Serie A) |
| 2 | England | 47 (Premier League) |
| 5 | Spain | 87 (LaLiga) |
| 13 | Belgium | 40 (First Division A) |
| 15 | Ukraine | 441 (Ukrainian Premier League) |

Found via `GET /api/tournaments?clubs=true`, which also lists every real club per tournament with its own `id`/`name`/`code` (a separate ID space from FotMob's team IDs — no shared key, matching is by normalized name).

## Endpoints

### GET `/api/leagues?filter[tournament_id]={id}&page[size]=1`

Used by: `resolveMantraLeagueId`

Resolves a tournament to a currently-active `league_id`. **`league_id` is season-scoped and changes every season** — this is why positions had to be re-entered manually each season. Any active league belonging to the tournament works; the `/api/players` endpoint below resolves `league_id` to the tournament's whole player pool server-side, not just that one fantasy room's drafted players.

```json
{ "data": [{ "id": 591, "tournament_id": 15, "season_id": 8, "status": "active", "division": "B3" }] }
```

### GET `/api/players?filter[league_id]={id}&page[number]={n}&page[size]=100`

Used by: `fetchMantraTournamentPlayers`

Returns every real-world player for the resolved tournament with the official Mantra position assignment.

```json
{
  "data": [{
    "id": 9002,
    "name": "Smolyakov",
    "first_name": "Artem",
    "club": { "id": 243, "name": "Kharkiv", "code": "KHA" },
    "position_classic_arr": ["LB", "WB"],
    "position_ital_arr": ["Ds", "E"]
  }],
  "meta": { "page": { "per_page": 100, "total_pages": 5, "current_page": 1 } }
}
```

**Critical quirks:**
- `page[size]` is **capped at 100 server-side** regardless of what's requested — always paginate to `meta.page.total_pages`.
- `filter[tournament_id]` is **silently ignored** here (unlike on `/api/leagues`) — it just returns the entire unfiltered global player pool (17k+ players) if you try it. Always resolve `league_id` first.
- `name` is the **last name**, `first_name` is the first name — full name is `${first_name} ${name}`.
- Names are already Latin-transliterated site-side, including Cyrillic (Ukrainian) names — no transliteration needed on our end.
- `position_classic_arr` values (`GK`/`RB`/`CB`/`LB`/`WB`/`DM`/`CM`/`W`/`AM`/`FW`/`ST`) are the exact same code space as our `MantraPosition` type — no translation needed, just cast.

### `/teams/{id}` — requires login, and is plain server-rendered HTML (no JSON API)

Confirmed via headless-browser probing (Playwright): an unauthenticated request 302s to `/users/sign_in`. Unlike `/leagues/{id}/players`, this page is **not** the client-rendered React shell — the roster table is rendered server-side in the initial HTML response (confirmed by grepping a raw authenticated `curl` response for a known player name — it was present before any JS executed). There is no JSON endpoint to call; `fetchMantraTeamRoster()` in `mantraFootball.ts` fetches the page and parses it with `cheerio`.

**Login flow** (`mantraLogin()` in `mantraFootball.ts`), plain `fetch`, no headless browser needed in production:
1. `GET /users/sign_in` with an **HTML** `Accept` header (`text/html,...` — reusing the JSON `Accept: application/json` header used elsewhere in this file makes Rails return **406 Not Acceptable**, since this route only serves HTML). Extract `authenticity_token` from the hidden form input, and the initial `Set-Cookie` (`_fanta_session`).
2. `POST /users/sign_in`, `application/x-www-form-urlencoded` body: `authenticity_token`, `user[email]`, `user[password]`, `user[remember_me]=0`, with the cookie from step 1. A successful login responds `302` to `/leagues` with a **new** `Set-Cookie` (Rails rotates the session id post-login) — that new cookie is the one to keep, not the pre-login one.

**Roster page parsing** (cheerio selectors, from the desktop layout only — the page duplicates every row for a mobile layout with the *same* `/players/{id}` link, so **dedupe by that id**):
- `a[href^="/players/{mantraPlayerId}"]` wraps each player row (the id is mantrafootball's own player id — the same id space as `/api/players`'s `id` field).
- `.team-player-last-name`, `.team-player-first-name` — plain text.
- `.team-player-position .player-position` (not `.team-player-position-mob`, the mobile duplicate) — one element per assigned position code, already in the `MantraPosition` code space.
- **No club name in this row as text** (only a club logo image) — resolve it by looking up the player id in the already-cached `getMantraTournamentPlayersCached()` list from the positions feature, which has `clubName` from the JSON API. Needed for `matchMantraPlayer`'s club-similarity signal when reconciling against FotMob.

**Stale-season guard:** a team the user hasn't renewed for the current season still resolves fine at `/teams/{id}` and renders normally — it just shows last season's roster with no error. `fetchMantraTeamRoster()` therefore also reads the page's `.league-season` text (`"Season 26-27 • Mantra"`) and compares its start year against `/api/seasons`'s latest entry; `POST /api/leagues/[id]/mantra-import` returns `409` if they don't match, rather than silently importing a stale squad.

**Session storage:** the app does **not** use env-var credentials or store a password anywhere. The squad builder UI (`SquadManager.tsx`) has a login form that posts to `POST /api/mantra-auth/login`, which calls `mantraLogin()` and, on success, sets the resulting mantrafootball.org session cookie as an `httpOnly` cookie on our own domain (`mantra_session`, 12h `maxAge`). `POST /api/leagues/[id]/mantra-import` reads that cookie to fetch the roster — the raw mantrafootball.org password is only ever held in browser memory for the duration of the login request, never persisted.
