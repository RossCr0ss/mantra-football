import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { Squad, SquadPlayer, MantraPosition, LineupStatus } from '@/types/squad';

export async function GET(req: NextRequest) {
  const leagueId = Number(req.nextUrl.searchParams.get('leagueId'));
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
  }

  const db = await getDb();
  const squad = await db.collection<Squad>('squads').findOne({ leagueId });
  return NextResponse.json({ players: squad?.players ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { leagueId: number; players: SquadPlayer[] };
  const { leagueId, players } = body;

  if (!leagueId || !Array.isArray(players)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const db = await getDb();
  await db.collection<Squad>('squads').updateOne(
    { leagueId },
    { $set: { leagueId, players, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    leagueId: number;
    playerId: number;
    mantraPositions?: MantraPosition[];
    lineupStatus?: LineupStatus | null;
    availabilityPct?: number;
  };
  const { leagueId, playerId, mantraPositions, lineupStatus, availabilityPct } = body;

  if (!leagueId || !playerId) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (mantraPositions !== undefined) {
    if (!Array.isArray(mantraPositions)) {
      return NextResponse.json({ error: 'Invalid mantraPositions' }, { status: 400 });
    }
    $set['players.$.mantraPositions'] = mantraPositions;
  }
  if (lineupStatus !== undefined) {
    $set['players.$.lineupStatus'] = lineupStatus ?? null;
  }
  if (availabilityPct !== undefined) {
    if (typeof availabilityPct !== 'number' || availabilityPct < 0 || availabilityPct > 100) {
      return NextResponse.json({ error: 'Invalid availabilityPct' }, { status: 400 });
    }
    $set['players.$.availabilityPct'] = availabilityPct;
  }

  const db = await getDb();
  await db.collection<Squad>('squads').updateOne(
    { leagueId, 'players.id': playerId },
    { $set },
  );

  return NextResponse.json({ ok: true });
}
