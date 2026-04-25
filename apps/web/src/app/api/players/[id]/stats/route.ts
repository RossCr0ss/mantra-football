export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPlayerRichStatsCached } from '@/lib/fotmobCache';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  }
  const stats = await getPlayerRichStatsCached(playerId);
  return NextResponse.json({ stats });
}
