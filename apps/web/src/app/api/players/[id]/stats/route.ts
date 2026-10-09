export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { parseIdParam, apiError } from '@/lib/apiUtils';
import { getPlayerRichStatsCached } from '@/lib/fotmobCache';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const playerId = parseIdParam(params.id);
  if (playerId === null) return apiError('Invalid player id');
  const stats = await getPlayerRichStatsCached(playerId);
  return NextResponse.json({ stats });
}
