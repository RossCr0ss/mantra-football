export default function TeamPageLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl animate-pulse space-y-6">
        {/* Breadcrumb placeholder */}
        <div className="h-4 w-48 rounded bg-gray-700" />
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-700" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray-700" />
            <div className="h-5 w-40 rounded bg-gray-600" />
          </div>
        </div>
        {/* Nav */}
        <div className="h-10 w-full rounded-xl bg-gray-800" />
        {/* Summary bar */}
        <div className="h-20 w-full rounded-2xl bg-gray-800" />
        {/* Player cards grid */}
        <div className="space-y-4">
          {[3, 8, 9, 6].map((count, si) => (
            <div key={si} className="space-y-2">
              <div className="h-4 w-28 rounded bg-gray-700" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} className="h-52 rounded-xl bg-gray-800" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
