import Image from 'next/image';
import Link from 'next/link';
import type { FotMobLeague } from '@/lib/fotmob';

const FLAG_EMOJIS: Record<string, string> = {
  'GB-ENG': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  IT: '🇮🇹',
  BE: '🇧🇪',
};

interface LeagueCardProps {
  league: FotMobLeague;
}

export default function LeagueCard({ league }: LeagueCardProps) {
  const flag = FLAG_EMOJIS[league.countryCode] ?? '🌍';

  return (
    <Link href={`/league/${league.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-gray-900 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-2xl hover:shadow-black/40">
        {/* Top colour bar */}
        <div className="h-0.5 w-full" style={{ backgroundColor: league.primaryColor }} />

        <div className="flex flex-col items-center gap-4 px-6 py-8">
          {/* Logo */}
          <div className="relative h-20 w-20 drop-shadow-lg transition-transform duration-300 group-hover:scale-110">
            <Image
              src={league.logoUrl}
              alt={`${league.name} logo`}
              fill
              className="object-contain"
              unoptimized
            />
          </div>

          {/* Info */}
          <div className="text-center">
            <p className="text-xs font-medium text-gray-500">
              {flag} {league.country}
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-white">
              {league.name}
            </h2>
          </div>
        </div>

        {/* Bottom accent strip — appears on hover */}
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
          style={{ backgroundColor: league.primaryColor }}
        />
      </div>
    </Link>
  );
}
