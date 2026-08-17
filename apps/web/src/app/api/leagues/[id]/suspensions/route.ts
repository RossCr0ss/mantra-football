import { NextRequest, NextResponse } from 'next/server';
import { getLeagueSuspensionInfo, YELLOW_CARD_BAN_THRESHOLD } from '@/lib/suspensionCheck';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const leagueId = Number(params.id);
  if (!leagueId) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const infoMap = await getLeagueSuspensionInfo(leagueId);
  const players = Object.fromEntries(infoMap);
  return NextResponse.json({ players, yellowCardBanThreshold: YELLOW_CARD_BAN_THRESHOLD });
}
