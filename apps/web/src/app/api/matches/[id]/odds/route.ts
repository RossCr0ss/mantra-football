import { NextResponse } from 'next/server';
import { getMatchOddsCached } from '@/lib/fotmobCache';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const odds = await getMatchOddsCached(params.id);
  return NextResponse.json({ odds });
}
