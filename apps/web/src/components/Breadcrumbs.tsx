'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { useRef, useState, useEffect } from 'react';
import { LEAGUES } from '@/lib/fotmob';

const PAGE_LABELS: Record<string, string> = {
  team:      'My Team',
  analytics: 'Analytics',
  fixtures:  'Fixtures',
  tour:      'Tour',
  injuries:  'Injuries',
};

function LeagueSwitcher({ currentId, subPage }: { currentId: number; subPage: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const current = LEAGUES.find((l) => l.id === currentId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function navigate(leagueId: number) {
    setOpen(false);
    router.push(`/league/${leagueId}/${subPage}`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
      >
        {current?.logoUrl && (
          <Image src={current.logoUrl} alt="" width={14} height={14} className="rounded-sm" unoptimized />
        )}
        <span>{current?.name ?? `League ${currentId}`}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]">
          {LEAGUES.map((league) => (
            <button
              key={league.id}
              onClick={() => navigate(league.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors
                ${league.id === currentId
                  ? 'text-white bg-gray-700'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
            >
              {league.logoUrl && (
                <Image src={league.logoUrl} alt="" width={16} height={16} className="rounded-sm flex-shrink-0" unoptimized />
              )}
              {league.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Breadcrumbs() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();

  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments.at(-1) ?? '';
  const leagueId = params.id ? Number(params.id) : undefined;
  const subPage = leagueId ? (segments[2] ?? 'team') : 'team';

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link href="/" className="text-gray-400 hover:text-white">Leagues</Link>

      {leagueId && (
        <>
          <span className="text-gray-600">/</span>
          <LeagueSwitcher currentId={leagueId} subPage={subPage} />
        </>
      )}

      {leagueId && PAGE_LABELS[lastSegment] && (
        <>
          <span className="text-gray-600">/</span>
          <span className="font-medium text-white">{PAGE_LABELS[lastSegment]}</span>
        </>
      )}
    </nav>
  );
}
