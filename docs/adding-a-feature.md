# Adding a Feature — Patterns & Checklist

Common patterns for extending the app without breaking existing behaviour.

---

## Adding a new player stat

**Scenario:** You want to track a new stat from FotMob (e.g. `passAccuracy`) and show it in analytics.

### Step 1 — Add to `PlayerSeasonStats`

In `apps/web/src/lib/fotmob.ts`:

```typescript
export interface PlayerSeasonStats {
  // ... existing fields ...
  passAccuracy: number | null;   // add nullable — not all leagues have it
}
```

### Step 2 — Add the stat list fetch

In `fotmob.ts`, no change needed — `fetchLeagueStatsList` is generic. Just call it with the right key.

In `fotmobCache.ts`, add a cached wrapper if you want a dedicated function, or call `getLeagueStatsListCached` directly with the FotMob stat key.

Find the stat key by inspecting `https://data.fotmob.com/stats/{leagueId}/season/{seasonId}/` — try keys like `passaccuracy`, `passes`, etc.

### Step 3 — Populate in the analytics route

In `apps/web/src/app/api/leagues/[id]/analytics/route.ts`:

```typescript
const [/* existing */, paMap] = await Promise.all([
  // existing fetches...
  getLeagueStatsListCached(leagueId, seasonId, 'passaccuracy'),
]);

allStats.forEach((s, id) => {
  // existing assignments...
  s.passAccuracy = paMap.get(id) ?? null;
});
```

### Step 4 — Show in the analytics page

In `apps/web/src/app/league/[id]/analytics/page.tsx`, add a column to the sortable table.

### Step 5 — Use in tour scoring (optional)

If the stat should influence auto-select, update `calcScore()` in `apps/web/src/app/league/[id]/tour/page.tsx`.

---

## Adding a new API route

1. Create `apps/web/src/app/api/{path}/route.ts`
2. Export `GET`, `POST`, `PATCH`, or `DELETE` async functions
3. Always validate required params and return early with `{ status: 400 }` on bad input
4. Use `getDb()` for MongoDB access, never a direct MongoDB client
5. Use cached wrappers from `fotmobCache.ts` for any FotMob data — never call `fotmob.ts` raw functions directly from routes
6. Add the route to the API routes table in `CLAUDE.md`

---

## Adding a new page

1. Create `apps/web/src/app/league/[id]/{name}/page.tsx`
2. If it needs pre-fetched data → server component; pass data to a client component for interactivity
3. If it's all interactive with no SSR benefit → client component (`'use client'`)
4. Always include `<Breadcrumbs />` and `<LeagueNav leagueId={...} />`
5. Add the route to `LeagueNav.tsx` (`NAV_ITEMS` array)
6. Add to the Pages table in `CLAUDE.md`

---

## Adding a new FotMob function

1. Add raw function to `fotmob.ts` with `next: { revalidate: N }` on every `fetch()` call
2. Add a MongoDB-cached wrapper in `fotmobCache.ts` using `withCache`
3. Choose appropriate TTL from `CACHE_TTL` in `mongoCache.ts`, or add a new constant
4. If returning a `Map`, serialise to array for MongoDB storage (see existing examples in `fotmobCache.ts`)
5. Update the FotMob functions table in `CLAUDE.md`
6. Add the endpoint to `docs/fotmob-api.md` with response shape and any quirks

---

## Modifying `SquadPlayer`

`SquadPlayer` is stored in MongoDB. Backward compat is implicit — MongoDB documents that predate a new field will just have `undefined` for it.

1. Add new field to `interface SquadPlayer` in `apps/web/src/types/squad.ts` as optional (`?`)
2. Handle `undefined` gracefully everywhere the field is read (usually `?? defaultValue`)
3. If the field needs to be saved via the PATCH endpoint, update:
   - `apps/web/src/app/api/squad/route.ts` — accept the field in the PATCH body, add `$set['players.$.fieldName'] = value`
4. Update the SquadPlayer fields table in `CLAUDE.md`

---

## Changing the scoring algorithm

The entire scoring logic is in `calcScore()` in `apps/web/src/app/league/[id]/tour/page.tsx`.

- `ScoreBreakdown` interface defines what's tracked per component
- `scoreTier()` controls the display colour thresholds
- `autoSelect()` / `assignModule()` are the selection logic — they use `.scoreBreakdown.total` only; component breakdown is display-only

See `docs/scoring.md` for a full explanation of each component and tuning guidance.

---

## Checklist for any change

- [ ] TypeScript compiles: `yarn workspace @mantra-football/web tsc --noEmit`
- [ ] New fields on `SquadPlayer` are optional and have sensible defaults
- [ ] New FotMob calls go through `fotmobCache.ts` in API routes
- [ ] New pages added to `LeagueNav` and documented in `CLAUDE.md`
- [ ] New API routes documented in `CLAUDE.md`
- [ ] `docs/` updated if the change affects architecture, FotMob API usage, scoring, or availability model
