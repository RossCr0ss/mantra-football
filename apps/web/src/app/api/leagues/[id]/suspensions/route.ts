import { NextRequest, NextResponse } from 'next/server';
import { parseLeagueParam, apiError } from '@/lib/apiUtils';
import { getLeagueSuspensionInfo, YELLOW_CARD_BAN_THRESHOLD } from '@/lib/suspensionCheck';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = parseLeagueParam(params.id);
  if (!league) return apiError('League not found', 404);
  const leagueId = league.id;

  const infoMap = await getLeagueSuspensionInfo(leagueId);
  const players = Object.fromEntries(infoMap);
  return NextResponse.json({ players, yellowCardBanThreshold: YELLOW_CARD_BAN_THRESHOLD });
}
