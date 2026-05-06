# FotMob API Reference

FotMob is used as the primary data source. There is no API key — requests use a standard browser User-Agent. All calls go through `apps/web/src/lib/fotmob.ts`. Never call FotMob URLs directly from components or API routes.

## Base URLs

| Host | Usage |
|---|---|
| `https://www.fotmob.com/api/` | Main API: league, team, player, match data |
| `https://data.fotmob.com/stats/` | Static CDN: gzipped season stat lists |
| `https://images.fotmob.com/image_resources/` | Player and team images |

---

## Endpoints

### GET `/api/data/leagues?id={leagueId}`

Used by: `fetchLeagueTeams`, `fetchLeagueData`

Returns league table, all season matches, and current round info.

**Critical:** matches are at `data.fixtures.allMatches`, **not** `data.matches`. This is a common source of confusion — the key is `fixtures`, not `matches`.

**Table structure (two shapes):**

Standard leagues (PL, Serie A, LaLiga):
```json
{
  "table": [{ "data": { "table": { "all": [{ "id": 9825, "name": "Arsenal", "shortName": "Arsenal" }] } } }]
}
```

Playoff/group leagues (Belgian Pro League):
```json
{
  "table": [{ "data": { "tables": [{ "table": { "all": [...] } }, { "table": { "all": [...] } }] } }]
}
```

`extractTableRows()` in `fotmob.ts` handles both shapes automatically.

**Match structure:**
```json
{
  "fixtures": {
    "allMatches": [{
      "id": "4193490",
      "round": "32",
      "roundName": "32",
      "home": { "id": "9825", "name": "Arsenal" },
      "away": { "id": "8456", "name": "Chelsea" },
      "status": {
        "utcTime": "2025-04-20T14:00:00.000Z",
        "finished": true,
        "started": true,
        "cancelled": false,
        "scoreStr": "2 - 1"
      }
    }],
    "firstUnplayedMatch": {
      "firstUnplayedMatchId": "4193490"
    }
  }
}
```

**Score parsing:** Scores are in `status.scoreStr` as `"homeGoals - awayGoals"` (e.g. `"2 - 1"`). The old `home.score` / `away.score` fields are no longer populated. `fetchLeagueData` parses `scoreStr` with a fallback to `home.score` for legacy compatibility.

**Quirks:**
- `home.id` and `away.id` are **strings** — always wrap in `Number()`. Forgetting this causes team ID mismatches when building fixtures.
- `round` and `roundName` may differ; use whichever is non-null for the round label.
- LaLiga playoff rounds reset to `"1"`, `"2"` etc. after regular season. Since these overlap with regular-season round numbers, filter `!m.finished` when building fixtures to avoid matching already-played rounds.
- `firstUnplayedMatchId` is the reliable way to find the current round. The old `firstUnplayedMatchIndex` was 1-based and unreliable.

---

### GET `/api/data/teams?id={teamId}`

Used by: `fetchTeamPlayers`, `fetchTeamPlayerStats`, `fetchLeagueSeasonId`

Returns full squad, season stats per player, and `primarySeasonId`.

**Squad structure:**
```json
{
  "squad": {
    "squad": [
      {
        "title": "keepers",
        "members": [{ "id": 976428, "name": "Raya", "rating": 7.2, "goals": 0, "assists": 0, "ycards": 1, "rcards": 0 }]
      },
      { "title": "defenders", "members": [...] },
      { "title": "midfielders", "members": [...] },
      { "title": "attackers", "members": [...] }
    ]
  },
  "stats": { "primarySeasonId": 27187 },
  "overview": {
    "lastLineupStats": {
      "starters": [{ "id": 976428, "name": "Raya", "usualPlayingPositionId": 0 }],
      "subs": [...]
    }
  }
}
```

**Critical: Ukrainian clubs (and other smaller leagues)**

For most clubs outside Shakhtar/Dynamo (Ukrainian Premier League), `squad.squad` is `null`. FotMob simply doesn't maintain full squad data for smaller clubs.

Fallback: `fetchTeamPlayersFromLineup()` reads `overview.lastLineupStats.starters + subs` — the players from the most recent match lineup. This gives ~20–23 players. Position is derived from `usualPlayingPositionId`:
- `0` → GK
- `1` → DEF
- `2` → MID
- `3` → FWD

These players have no season stats (rating, goals, assists all null/0) since that data comes from the squad endpoint.

**`primarySeasonId`** is used for fetching league stat lists from `data.fotmob.com`. Get it via `fetchLeagueSeasonId(leagueId)` which internally picks a team and reads its `stats.primarySeasonId`.

---

### GET `/api/data/playerData?id={playerId}`

Used by: `fetchPlayerInjuryInfo`, `fetchPlayerSeasonStats`, `fetchPlayerRichStats`

Returns detailed player data including injury information and per-player season stats with percentile ranks.

**Note the path prefix:** `/api/data/playerData`, not `/api/playerData`.

**Injury structure:**
```json
{
  "injuryInformation": {
    "name": "Muscle Strain",
    "expectedReturn": {
      "expectedReturnFallback": "25 Apr",
      "expectedReturnDateParam": "2025-04-25"
    },
    "lastUpdated": { "utcTime": "2025-04-18T10:00:00.000Z" }
  }
}
```

If `injuryInformation` is absent or null, the player is not injured. The function returns `null` in that case.

**⚠ Cloudflare Turnstile protection:** All server-side requests (Node.js, curl) receive `{"error":"Verification required","code":"TURNSTILE_REQUIRED"}`. This affects `fetchPlayerSeasonStats` and `fetchPlayerRichStats` — those functions will silently fail and their cache wrappers (`fotmob_player_stats`, `fotmob_rich_stats`) will remain empty.

Injury fetching (`fetchPlayerInjuryInfo`) is called from the team page server component and appears to work in some regions/configurations. If it stops working, set `FOTMOB_COOKIE` env var with a valid browser cookie to bypass Turnstile.

**Season stats structure** (from `firstSeasonStats.statsSection`):
```json
{
  "groups": [{
    "localizedTitleId": "shooting",
    "title": "Shooting",
    "items": [{ "localizedTitleId": "goals", "title": "Goals", "statValue": 12, "percentileRank": 92.5 }]
  }]
}
```

---

### GET `/api/data/matchOdds?matchId={id}&ccode3={ccode3}&bettingProvider={provider}`

Used by: `fetchMatchOdds`

Returns 1×2 betting odds for a match. **Geo-restricted** — requires country code and provider matching the user's region.

Default values (set via env vars):
- `FOTMOB_CCODE3=UKR`
- `FOTMOB_BETTING_PROVIDER=22Bet_Ukraine`

**Odds structure:**
```json
{
  "odds": {
    "matchfactMarkets": [{
      "selections": [
        { "name": "1", "oddsDecimal": "1.85" },
        { "name": "x", "oddsDecimal": "3.60" },
        { "name": "2", "oddsDecimal": "4.50" }
      ]
    }]
  }
}
```

`name: "1"` = home win, `"x"` = draw, `"2"` = away win. `oddsDecimal` is a **string** — parse with `parseFloat()`.

Returns HTTP 204 when odds are unavailable (pre-season, cup matches, etc.). `fetchMatchOdds` treats 204 as `null`.

**Why server-side only?** Client-side requests to this endpoint get geo-blocked. The `/api/matches/[id]/odds` route acts as a server-side proxy — `fetchMatchOddsClient()` hits that proxy, which in turn calls `fetchMatchOdds()` server-side.

---

### GET `data.fotmob.com/stats/{leagueId}/season/{seasonId}/rating.json`

Used by: `fetchLeagueRatingStats`

Gzipped static JSON with rating rankings for all players in the league.

**Structure:**
```json
{
  "TopLists": [{
    "StatName": "rating",
    "StatList": [
      { "ParticiantId": 976428, "Rank": 1, "MatchesPlayed": 28, "MinutesPlayed": 2520 }
    ]
  }]
}
```

Note: `ParticiantId` is intentionally misspelled in the FotMob API (not a typo in our code).

**Known limitation:** Ukrainian Premier League (leagueId 441) returns **403** for `rating.json`. Only `goals.json` is publicly accessible for that league. As a result, Ukrainian players have `leagueRank: null`, `matchesPlayed: null`, and `minutesPlayed: null` in analytics.

---

### GET `data.fotmob.com/stats/{leagueId}/season/{seasonId}/{statKey}.json`

Used by: `fetchLeagueStatsList`

Same CDN host, returns per-player values for a specific stat. Used by `fetchLeagueStatsList` (single key) and `fetchLeagueAllPlayerStats` (all 19 keys in parallel).

**⚠ Key naming matters:** Keys are not intuitive. Wrong keys silently return 403. The correct names were discovered by inspecting `teams.stats.players[].name` on the teams endpoint.

**All 19 supported stat keys** (`CDN_STAT_CONFIG` in `fotmob.ts`):

| CDN key | `PlayerSeasonStats` field | Use `SubStatValue`? |
|---|---|---|
| `goals` | `goals` | no |
| `goal_assist` | `assists` | no |
| `mins_played` | `minutesPlayed` | no |
| `expected_goals` | `expectedGoals` | yes |
| `ontarget_scoring_att` | `shots` | yes |
| `total_att_assist` | `chancesCreated` | no |
| `big_chance_created` | `bigChancesCreated` | yes |
| `big_chance_missed` | `bigChancesMissed` | yes |
| `total_tackle` | `tackles` | yes |
| `interception` | `interceptions` | yes |
| `effective_clearance` | `clearances` | yes |
| `outfielder_block` | `blockedShots` | yes |
| `poss_won_att_3rd` | `possessionWonFinal3rd` | yes |
| `clean_sheet` | `cleanSheets` | no |
| `_save_percentage` | `savePercentage` | no (placeholder — may 404) |
| `saves` | `saves` | yes |
| `_goals_prevented` | `goalsPrevented` | no (placeholder — may 404) |
| `goals_conceded` | `goalsConceded` | yes |
| `fouls` | `foulsCommitted` | yes |

`SubStatValue` = the raw season total. `StatValue` = display value (may be per-game or formatted). Most counting stats (tackles, interceptions, etc.) use `SubStatValue`.

Keys prefixed with `_` (like `_save_percentage`) are placeholders — their actual CDN filenames may differ. These fields may remain `null` for some leagues.

**Structure:**
```json
{
  "TopLists": [{
    "StatList": [
      { "ParticiantId": 976428, "StatValue": 12, "SubStatValue": 15 }
    ]
  }]
}
```

Returns an empty Map (not an error) if the endpoint 404s or 403s — this is the normal behaviour for keys that don't exist for a given league.

### `fetchLeagueAllPlayerStats(leagueId, seasonId)`

Fetches all 19 stat keys in parallel and merges them into a single `Map<playerId, Partial<PlayerSeasonStats>>`. This is the preferred way to populate analytics — one cache document per league-season instead of 19 separate documents.

Used by `getLeagueAllPlayerStatsCached` in `fotmobCache.ts`, which stores results in the `fotmob_all_stats` collection.

---

## Image URLs

All image URLs are constructed from IDs — never stored in the database.

| Type | URL pattern |
|---|---|
| Player photo | `https://images.fotmob.com/image_resources/playerimages/{playerId}.png` |
| Team logo | `https://images.fotmob.com/image_resources/logo/teamlogo/{teamId}.png` |
| League logo | `https://images.fotmob.com/image_resources/logo/leaguelogo/{leagueId}.png` |

---

## Known API quirks summary

| Quirk | Impact | Fix |
|---|---|---|
| Matches at `data.fixtures.allMatches` not `data.matches` | No matches loaded | Use `data?.fixtures` key |
| `home.id` / `away.id` are strings | Team ID mismatches | Always `Number(id)` |
| Scores in `status.scoreStr` not `home.score`/`away.score` | All form results show null | Parse `"2 - 1"` format; fallback to `home.score` |
| Belgian Pro League: `tables[].table.all` shape | Empty team list | `extractTableRows()` handles both shapes |
| LaLiga playoff rounds reset to 1, 2… | Wrong fixture round | Filter `!m.finished` in `buildTeamFixtures` |
| Ukrainian clubs: `squad.squad = null` | "No players found" | `fetchTeamPlayersFromLineup` fallback |
| Odds are geo-restricted | 404/block client-side | Server-side only, proxy via `/api/matches/[id]/odds` |
| Ukrainian rating.json → 403 | No league rank data | Silently returns empty Map; players show `leagueRank: null` |
| `playerData` endpoint → Turnstile | `fetchPlayerSeasonStats`/`fetchPlayerRichStats` fail | CDN stats (`fotmob_all_stats`) cover most fields; set `FOTMOB_COOKIE` for remainder |
| Wrong CDN stat key names → 403 | Stats remain null | Use exact keys from `CDN_STAT_CONFIG` — not guessed names |
| `ParticiantId` is a typo in FotMob API | Code looks like a typo | It's correct — FotMob's field is misspelled |
| `primarySeasonId` is a number in JSON | Wrong type if used as string | Always `String(seasonId)` when passing to stat endpoints |
