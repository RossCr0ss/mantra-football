# Player Availability Model

Players have two orthogonal availability fields that control their tour selection behaviour.

---

## Fields on `SquadPlayer`

```typescript
lineupStatus?: 'injured' | 'suspended'   // hard block
availabilityPct?: number                 // 0–100, default 100
```

### `lineupStatus`

A hard block. Set when a player **cannot play** regardless of other factors.

| Value | Meaning | Tour effect |
|---|---|---|
| `undefined` | Available | Normal scoring |
| `'injured'` | Injured — cannot play | Score = −999, excluded from auto-select |
| `'suspended'` | Suspended — cannot play | Score = −999, excluded from auto-select |

Players with `lineupStatus` set can still be **manually** added to the main XI by clicking them (the hard block only affects auto-select).

### `availabilityPct`

A soft signal. Set when a player **may** play but with reduced expected minutes.

| Value | Meaning | Tour effect |
|---|---|---|
| 100 (default) | Confirmed starter | Score × 1.0 |
| 75 | Likely starter | Score × 0.75 |
| 50 | Bench / uncertain | Score × 0.50 |
| 0 | Not expected to play | Score × 0 (ranks at bottom, auto-select skips) |

A 0% player is NOT blocked — they can still be manually selected. They just have a score of 0.

---

## Where it's set

### TeamSquadView (`/league/[id]/team`)

Each player card has:
- **Injury / Suspension toggles** — tapping toggles the status on/off; tapping the active one clears it
- **Availability % buttons** (0% / 50% / 75% / 100%) — only shown when not injured/suspended

### InjuryReportView (`/league/[id]/injuries`)

Quick actions per player:
- **Healed** button — clears FotMob injury data (calls `PUT /api/players/[id]/injury` with `{cleared: true}`) and removes `lineupStatus: 'injured'` if set
- **Clear** button (suspended players) — sends `PATCH /api/squad` with `{lineupStatus: null}`
- **Full** button (doubtful players) — sends `PATCH /api/squad` with `{availabilityPct: 100}`

---

## Persistence

Both fields are stored on the `SquadPlayer` object inside the `squads` MongoDB collection.

`PATCH /api/squad` accepts:
```typescript
{
  leagueId: number
  playerId: number
  lineupStatus?: 'injured' | 'suspended' | null   // null clears it
  availabilityPct?: number   // 0–100
}
```

---

## Injury data sources

Injury info (`PlayerInjuryInfo`) is separate from `lineupStatus`. It comes from two sources, with DB override taking priority:

```
DB collection player_injuries (manual override)
          ↓ if not found or cleared=false
FotMob /api/playerData?id={playerId}
```

`getPlayerInjury(playerId)` in `injuries.ts` implements this logic.

### DB override shape

```typescript
{
  playerId: number
  name: string              // injury name, e.g. "Muscle Strain"
  expectedReturn: string    // display string, e.g. "25 Apr"
  expectedReturnDate: string  // ISO date for comparison, e.g. "2025-04-25"
  lastUpdated: string
  cleared: boolean          // true = suppress FotMob data, player is healthy
}
```

`cleared: true` means the user has manually marked the player as healed. This suppresses FotMob data even if FotMob still shows an injury (useful when FotMob is slow to update).

### API routes for injury

| Method | Endpoint | Effect |
|---|---|---|
| GET | `/api/players/[id]/injury` | Return injury info (DB override → FotMob fallback) |
| PUT | `/api/players/[id]/injury` | Save manual override; pass `{cleared: true}` to mark healed |
| DELETE | `/api/players/[id]/injury` | Remove DB override; returns current live FotMob data |

---

## Injuries page (`/league/[id]/injuries`)

Shows three sections:

1. **Injured** — players where `injuries[p.id] != null` (FotMob data) OR `lineupStatus === 'injured'` (manually set)
2. **Suspended** — players where `lineupStatus === 'suspended'`
3. **Limited availability** — players where `availabilityPct < 100` and not injured/suspended

A player can appear in section 1 and 2 simultaneously (injured AND suspended) since they're independent. Sections are separate lists, not mutually exclusive.

Data is pre-fetched server-side (parallel `getPlayerInjury` calls for all 26 squad players), then passed to `InjuryReportView` client component for interaction.
