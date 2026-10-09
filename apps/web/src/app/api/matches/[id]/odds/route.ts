import { NextResponse } from 'next/server';
import { parseIdParam, apiError } from '@/lib/apiUtils';
import { getMatchOddsCached } from '@/lib/fotmobCache';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (parseIdParam(params.id) === null) return apiError('Invalid match id');
  const odds = await getMatchOddsCached(params.id);
  return NextResponse.json({ odds });
}
