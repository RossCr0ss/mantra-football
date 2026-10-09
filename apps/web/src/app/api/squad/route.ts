import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findLeague, parseIdParam, apiError } from '@/lib/apiUtils';
import { MANTRA_POSITIONS } from '@/lib/mantraPositions';
import { validateSquadPayload } from '@/lib/squadValidation';
import type { Squad, SquadPlayer, MantraPosition, LineupStatus } from '@/types/squad';

const VALID_POSITIONS = new Set<string>(MANTRA_POSITIONS.map((p) => p.code));

/** Parses the JSON body, or null when it is missing/malformed. */
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

export async function GET(req: NextRequest) {
  const league = findLeague(parseIdParam(req.nextUrl.searchParams.get('leagueId')));
  if (!league) return apiError('Valid leagueId required');
  const leagueId = league.id;

  const db = await getDb();
  const squad = await db.collection<Squad>('squads').findOne({ leagueId });
  return NextResponse.json({ players: squad?.players ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ leagueId: number; players: SquadPlayer[] }>(req);
  if (!body || !findLeague(body.leagueId) || !Array.isArray(body.players)) return apiError('Invalid payload');
  const leagueId = body.leagueId;
  const validated = validateSquadPayload(body.players);
  if ('error' in validated) return apiError(validated.error);
  const players = validated.players;

  const db = await getDb();
  await db.collection<Squad>('squads').updateOne(
    { leagueId },
    { $set: { leagueId, players, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await readJson<{
    leagueId: number;
    playerId: number;
    mantraPositions?: MantraPosition[];
    lineupStatus?: LineupStatus | null;
    availabilityPct?: number;
    availabilityPctSource?: 'manual' | 'suggested';
    lineupStatusSource?: 'manual' | 'auto';
    teamId?: number;
    teamName?: string;
  }>(req);
  if (!body) return apiError('Invalid payload');
  const {
    leagueId, playerId, mantraPositions, lineupStatus, availabilityPct, availabilityPctSource,
    lineupStatusSource, teamId, teamName,
  } = body;

  if (!findLeague(leagueId) || !playerId) return apiError('Invalid payload');

  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (mantraPositions !== undefined) {
    if (!Array.isArray(mantraPositions) || mantraPositions.some((m) => !VALID_POSITIONS.has(m))) {
      return apiError('Invalid mantraPositions');
    }
    $set['players.$.mantraPositions'] = mantraPositions;
  }
  if (lineupStatus !== undefined) {
    if (lineupStatus !== null && lineupStatus !== 'injured' && lineupStatus !== 'suspended') {
      return apiError('Invalid lineupStatus');
    }
    $set['players.$.lineupStatus'] = lineupStatus ?? null;
  }
  if (lineupStatusSource !== undefined) {
    $set['players.$.lineupStatusSource'] = lineupStatusSource;
  }
  if (availabilityPct !== undefined) {
    if (typeof availabilityPct !== 'number' || availabilityPct < 0 || availabilityPct > 100) {
      return NextResponse.json({ error: 'Invalid availabilityPct' }, { status: 400 });
    }
    $set['players.$.availabilityPct'] = availabilityPct;
  }
  if (availabilityPctSource !== undefined) {
    $set['players.$.availabilityPctSource'] = availabilityPctSource;
  }
  if (teamId !== undefined && teamName !== undefined) {
    $set['players.$.teamId'] = teamId;
    $set['players.$.teamName'] = teamName;
  }

  const db = await getDb();
  await db.collection<Squad>('squads').updateOne(
    { leagueId, 'players.id': playerId },
    { $set },
  );

  return NextResponse.json({ ok: true });
}
