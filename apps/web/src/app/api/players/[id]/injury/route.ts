export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getPlayerInjury, fetchPlayerInjuryFresh, evictInjuryCache } from '@/lib/injuries';
import type { PlayerInjuryInfo } from '@/lib/fotmob';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  }

  const injury = await getPlayerInjury(playerId);
  return NextResponse.json({ injury });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  }

  const body = await req.json() as {
    name?: string;
    expectedReturn?: string | null;
    expectedReturnDate?: string | null;
    /** When true, marks the player as healed — suppresses FotMob injury data */
    cleared?: boolean;
  };

  const db = await getDb();
  const lastUpdated = new Date().toISOString();

  // Mark as healed: suppresses FotMob data, stores cleared flag
  if (body.cleared) {
    await db.collection('player_injuries').updateOne(
      { playerId },
      { $set: { playerId, cleared: true, lastUpdated } },
      { upsert: true },
    );
    await evictInjuryCache(playerId);
    const clearedInfo: PlayerInjuryInfo = {
      name: 'Manually healed',
      expectedReturn: null,
      expectedReturnDate: null,
      lastUpdated,
      overridden: true,
      cleared: true,
    };
    return NextResponse.json({ ok: true, injury: clearedInfo });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  await db.collection('player_injuries').updateOne(
    { playerId },
    {
      $set: {
        playerId,
        name: body.name.trim(),
        expectedReturn: body.expectedReturn ?? null,
        expectedReturnDate: body.expectedReturnDate ?? null,
        lastUpdated,
        cleared: false,
      },
    },
    { upsert: true },
  );

  const injury: PlayerInjuryInfo = {
    name: body.name.trim(),
    expectedReturn: body.expectedReturn ?? null,
    expectedReturnDate: body.expectedReturnDate ?? null,
    lastUpdated,
    overridden: true,
  };
  return NextResponse.json({ ok: true, injury });
}

/**
 * DELETE — removes the manual override entirely so FotMob data flows again.
 * Returns the fresh FotMob injury (or null if FotMob shows no injury).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  }

  const db = await getDb();
  await db.collection('player_injuries').deleteOne({ playerId });
  await evictInjuryCache(playerId);

  // Return fresh FotMob data so the client can immediately show the correct state
  const injury = await fetchPlayerInjuryFresh(playerId);
  return NextResponse.json({ ok: true, injury });
}
