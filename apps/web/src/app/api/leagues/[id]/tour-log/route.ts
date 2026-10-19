export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import { getDb } from '@/lib/mongodb';
import type { TourLogEntry } from '@/lib/tourLog';

const COLLECTION = 'tour_logs';

/** Stored recommendations of a league, newest first (`?round=` filters one round). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);

  const round = req.nextUrl.searchParams.get('round');
  const db = await getDb();
  const logs = await db.collection(COLLECTION)
    .find({ leagueId: league.id, ...(round ? { round } : {}) }, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return NextResponse.json({ logs });
}

/** Upserts the engine's recommendation for (league, round): the last one before the matchday wins. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);

  let entry: TourLogEntry;
  try { entry = (await req.json()) as TourLogEntry; } catch { return apiError('Invalid payload'); }
  if (
    !entry || typeof entry.round !== 'string' || !entry.round || typeof entry.formation !== 'string' ||
    !Array.isArray(entry.slots) || entry.slots.length !== 11 || !Array.isArray(entry.players) || entry.players.length > 60
  ) {
    return apiError('Invalid payload');
  }

  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { leagueId: league.id, round: entry.round },
    { $set: { ...entry, leagueId: league.id, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
