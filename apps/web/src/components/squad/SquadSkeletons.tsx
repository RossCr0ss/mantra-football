'use client';



export function TeamsSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="shimmer h-9 w-20 rounded-xl" />
      ))}
    </div>
  );
}

export function PlayersSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-white/8 bg-gray-900">
          <div className="shimmer h-32 w-full" />
          <div className="flex flex-col gap-2 p-3">
            <div className="shimmer mx-auto h-3 w-20 rounded" />
            <div className="shimmer mx-auto h-2.5 w-14 rounded" />
            <div className="shimmer h-7 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
