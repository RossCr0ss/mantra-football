export default function InjuriesPageLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl animate-pulse space-y-6">
        <div className="h-4 w-48 rounded bg-gray-700" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-700" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray-700" />
            <div className="h-5 w-40 rounded bg-gray-600" />
          </div>
        </div>
        <div className="h-10 w-full rounded-xl bg-gray-800" />
        <div className="space-y-3">
          <div className="h-5 w-32 rounded bg-gray-700" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-gray-800" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-5 w-28 rounded bg-gray-700" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-gray-800" />
          ))}
        </div>
      </div>
    </main>
  );
}
