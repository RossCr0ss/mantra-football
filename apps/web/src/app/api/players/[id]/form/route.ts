import { NextRequest, NextResponse } from 'next/server';
import { parseIdParam, apiError } from '@/lib/apiUtils';
import { getPlayerFormCached } from '@/lib/fotmobCache';
import { suggestAvailabilityPct, summarizeRecentForm } from '@/lib/availabilitySuggestion';
import type { PositionGroup } from '@/types/squad';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const playerId = parseIdParam(params.id);
  if (playerId === null) return apiError('Invalid player id');

  const positionGroup = (req.nextUrl.searchParams.get('positionGroup') ?? 'MID') as PositionGroup;

  const matches = await getPlayerFormCached(playerId);
  const suggestedPct = suggestAvailabilityPct(matches);
  const summary = summarizeRecentForm(matches, positionGroup);

  return NextResponse.json({ matches, suggestedPct, ...summary });
}
