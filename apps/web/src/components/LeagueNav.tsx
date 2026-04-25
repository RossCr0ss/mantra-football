'use client';

import { useState, useTransition, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface Props {
  leagueId: number;
}

const NAV_ITEMS = (id: number) => [
  { label: 'My Team',   href: `/league/${id}/team`      },
  { label: 'Injuries',  href: `/league/${id}/injuries`  },
  { label: 'Analytics', href: `/league/${id}/analytics` },
  { label: 'Fixtures',  href: `/league/${id}/fixtures`  },
  { label: 'Tour',      href: `/league/${id}/tour`      },
];

function Spinner() {
  return (
    <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
  );
}

export default function LeagueNav({ leagueId }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
    }
  }, [isPending]);

  function navigate(href: string) {
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  const editHref = `/league/${leagueId}?edit=1`;

  return (
    <nav className="rounded-xl border border-white/8 bg-gray-900/60 p-1 flex flex-wrap items-center gap-1">
      {NAV_ITEMS(leagueId).map(({ label, href }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/');
        return (
          <button
            key={href}
            onClick={() => navigate(href)}
            className={
              isActive
                ? 'bg-white text-gray-900 rounded-lg px-3 py-1.5 text-xs font-semibold'
                : 'text-gray-400 hover:bg-white/8 hover:text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition'
            }
          >
            {isPending && pendingHref === href && <Spinner />}
            {label}
          </button>
        );
      })}

      <button
        onClick={() => navigate(editHref)}
        className="ml-auto text-gray-500 hover:text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition"
      >
        {isPending && pendingHref === editHref && <Spinner />}
        Edit Squad
      </button>
    </nav>
  );
}
