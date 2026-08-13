import { NextRequest, NextResponse } from 'next/server';
import { getPlayerFormCached } from '@/lib/fotmobCache';
import { suggestAvailabilityPct, summarizeRecentForm } from '@/lib/availabilitySuggestion';
import type { PositionGroup } from '@/types/squad';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });

  const leagueId = Number(req.nextUrl.searchParams.get('leagueId'));
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 });

  const positionGroup = (req.nextUrl.searchParams.get('positionGroup') ?? 'MID') as PositionGroup;

  const matches = await getPlayerFormCached(playerId, leagueId);
  const suggestedPct = suggestAvailabilityPct(matches);
  const summary = summarizeRecentForm(matches, positionGroup);

  return NextResponse.json({ matches, suggestedPct, ...summary });
}
