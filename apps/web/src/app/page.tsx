import LeagueCard from '@/components/LeagueCard';
import { LEAGUES } from '@/lib/fotmob';

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16 overflow-hidden">
      {/* Subtle radial gradient background accent */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(34,197,94,0.12) 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <div className="relative mb-14 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-green-500">
          Fantasy Manager
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
          Mantra Football
        </h1>
        <p className="mt-4 text-base text-gray-400 sm:text-lg">
          Select a league to build your squad and analyse your lineup
        </p>
      </div>

      {/* League cards */}
      <div className="relative grid w-full max-w-3xl grid-cols-1 gap-5 sm:grid-cols-3">
        {LEAGUES.map((league) => (
          <LeagueCard key={league.id} league={league} />
        ))}
      </div>
    </main>
  );
}
