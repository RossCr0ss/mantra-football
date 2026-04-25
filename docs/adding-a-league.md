# Adding a New League

## 1. Find the FotMob league ID

Go to `https://www.fotmob.com` and open the league page. The ID is in the URL:
```
https://www.fotmob.com/leagues/47/overview/premier-league
                                ^^
                             leagueId = 47
```

Alternatively, use the leagues endpoint directly:
```
https://www.fotmob.com/api/data/leagues?id=47
```

## 2. Test the league data shape

Before adding, verify two things:

**a) Table shape** — does it use standard or playoff/group format?

```bash
curl "https://www.fotmob.com/api/data/leagues?id=NEW_ID" | jq '.table[0].data | keys'
```

- If you see `"table"` → standard shape (Premier League style)
- If you see `"tables"` → playoff/group shape (Belgian Pro League style)

Both are handled by `extractTableRows()` automatically.

**b) Match data** — confirm matches are at `data.fixtures.allMatches`:

```bash
curl "https://www.fotmob.com/api/data/leagues?id=NEW_ID" | jq '.fixtures.allMatches | length'
```

Should return > 0 if the season has started.

**c) Check team squad coverage**

Pick a team from the league and check if `squad.squad` is null:

```bash
curl "https://www.fotmob.com/api/data/teams?id=TEAM_ID" | jq '.squad.squad | length'
```

If this returns `null` for most clubs (like Ukrainian Premier League), the `fetchTeamPlayersFromLineup` fallback will be used automatically — no code changes needed.

## 3. Add to the LEAGUES constant

Open `apps/web/src/lib/fotmob.ts` and add to the `LEAGUES` array:

```typescript
{
  id: 130,
  name: 'Bundesliga',
  country: 'Germany',
  countryCode: 'DE',
  primaryColor: '#d00027',    // used for section header badges
  secondaryColor: '#000000',
  logoUrl: 'https://images.fotmob.com/image_resources/logo/leaguelogo/130.png',
},
```

`primaryColor` shows up as the badge background in the team page section headers. Use the league's brand colour.

## 4. Verify rating stats are accessible

Not all leagues have stat JSON available on `data.fotmob.com`. Check:

```bash
# You need the seasonId first — get from any team in the league:
curl "https://www.fotmob.com/api/data/teams?id=TEAM_ID" | jq '.stats.primarySeasonId'

# Then test the rating endpoint:
curl "https://data.fotmob.com/stats/NEW_LEAGUE_ID/season/SEASON_ID/rating.json" -v
```

- **200** → full analytics (rating, rank, minutes) will work ✓
- **403** → no rating data for this league (like Ukrainian Premier League). Players will have `leagueRank: null` and `matchesPlayed: null`. The app handles this gracefully — analytics still shows goals/assists/etc.

Also test stat-specific endpoints (`cleansheet.json`, `expectedgoals.json`, etc.) the same way.

## 5. Test end-to-end

1. Start local dev: `docker compose up mongo -d && yarn dev`
2. Open `http://localhost:3000` — new league should appear on the home page
3. Click the league → squad builder should show teams
4. Add a few players → go to Analytics, Fixtures, Tour
5. Check browser console and server logs for any FotMob errors

## Known special cases

### Belgian Pro League (leagueId 40)

Uses split playoff tables. `extractTableRows()` handles this automatically.

### LaLiga (leagueId 87)

After round 30, playoff promotion/relegation rounds reset roundName to `"1"`, `"2"` etc., which collides with regular-season round numbers. `buildTeamFixtures` already handles this by filtering `!m.finished`, so only upcoming fixtures are considered.

### Ukrainian Premier League (leagueId 441)

14 of 16 clubs have `squad.squad = null`. The lineup fallback runs automatically. No rating stats available from `data.fotmob.com` (403).

### Leagues with cup rounds mixed in

Some leagues interleave cup matches in the fixture list. The current `buildTeamFixtures` doesn't filter by competition — it shows all unfinished matches. If a league mixes competitions heavily, you may want to add a `competitionId` filter.
