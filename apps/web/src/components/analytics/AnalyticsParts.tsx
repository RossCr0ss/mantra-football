'use client';

import Link from 'next/link';

export function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 px-5 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

export function EmptyState({ leagueId }: { leagueId: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-gray-900 px-8 py-20 text-center">
      <p className="mt-3 font-semibold text-white">No squad saved yet</p>
      <p className="mt-1 text-sm text-gray-500">Build your squad to see analytics</p>
      <Link
        href={`/league/${leagueId}`}
        className="mt-6 inline-block rounded-xl bg-green-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600"
      >
        Build Squad
      </Link>
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/8 bg-gray-900 px-5 py-4">
            <div className="shimmer h-3 w-16 rounded" />
            <div className="shimmer mt-2 h-7 w-12 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/8 bg-gray-900 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="shimmer h-11 w-11 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="shimmer h-3.5 w-28 rounded" />
                <div className="shimmer h-3 w-20 rounded" />
              </div>
              <div className="shimmer h-7 w-12 rounded" />
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="shimmer h-5 w-5 rounded-full" />
              ))}
            </div>
            <div className="shimmer h-14 w-full rounded-lg" />
            <div className="shimmer h-8 w-full rounded-lg" />
            <div className="shimmer h-4 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
