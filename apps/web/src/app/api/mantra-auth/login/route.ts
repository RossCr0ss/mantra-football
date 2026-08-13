import { NextRequest, NextResponse } from 'next/server';
import { mantraLogin } from '@/lib/mantraFootball';

const COOKIE_NAME = 'mantra_session';

export async function GET(req: NextRequest) {
  return NextResponse.json({ authenticated: !!req.cookies.get(COOKIE_NAME)?.value });
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'Email and password required' }, { status: 400 });
  }

  const sessionCookie = await mantraLogin(email, password);
  if (!sessionCookie) {
    return NextResponse.json({ ok: false, error: 'Invalid MantraFootball credentials' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 3600,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
