'use client';

import type { PlayerAnalytics } from '@/app/api/leagues/[id]/analytics/route';
import { RADAR_CONFIG, RADAR_PALETTE } from '@/components/analytics/analyticsUi';

export function RadarChart({
  player,
  group,
  maxima,
}: {
  player: PlayerAnalytics;
  group: string;
  maxima: Record<string, number>;
}) {
  const axes = RADAR_CONFIG[group];
  if (!axes) return null;
  const n = axes.length;
  const R = 32;
  const cx = 50;
  const cy = 50;
  const palette = RADAR_PALETTE[group] ?? RADAR_PALETTE.MID;

  function coord(idx: number, radius: number): [number, number] {
    const a = ((360 / n) * idx - 90) * (Math.PI / 180);
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  }
  function fmtCoord(c: [number, number]): string {
    return `${c[0].toFixed(2)},${c[1].toFixed(2)}`;
  }

  const values = axes.map((ax) => {
    const raw = (player[ax.key] as number | null) ?? 0;
    const max = maxima[ax.key] ?? 1;
    const norm = max > 0 ? Math.min(1, raw / max) : 0;
    return ax.negative ? Math.max(0, 1 - norm) : norm;
  });

  const hasData = axes.some((ax) => ((player[ax.key] as number | null) ?? 0) > 0);
  const polyPts = values.map((v, i) => fmtCoord(coord(i, Math.max(0.03, v) * R))).join(' ');

  return (
    <div className="relative w-full" style={{ paddingBottom: '100%' }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        {/* Grid rings */}
        {[0.25, 0.5, 0.75, 1].map((lvl) => (
          <polygon
            key={lvl}
            points={Array.from({ length: n }, (_, i) => fmtCoord(coord(i, lvl * R))).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="0.5"
          />
        ))}
        {/* Axis spokes */}
        {axes.map((_, i) => {
          const [x2, y2] = coord(i, R);
          return <line key={i} x1={cx} y1={cy} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
            stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />;
        })}
        {/* Player polygon */}
        {hasData && (
          <>
            <polygon points={polyPts} fill={palette.fill} stroke={palette.stroke}
              strokeWidth="1.2" strokeLinejoin="round" />
            {values.map((v, i) => {
              const [x, y] = coord(i, Math.max(0.03, v) * R);
              return <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r="1.8" fill={palette.dot} />;
            })}
          </>
        )}
        {/* Axis labels */}
        {axes.map((ax, i) => {
          const [lx, ly] = coord(i, R + 12);
          const raw = player[ax.key] as number | null;
          const rawStr = raw === null ? '—'
            : ax.key === 'expectedGoals' ? raw.toFixed(1)
            : String(raw);
          return (
            <text key={i} fontSize="5" textAnchor="middle">
              <tspan x={lx.toFixed(2)} y={(ly - 2.5).toFixed(2)} fill="rgba(255,255,255,0.35)">{ax.label}</tspan>
              <tspan x={lx.toFixed(2)} dy="6" fill={palette.stroke} fontWeight="bold">{rawStr}</tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Card stat components ─────────────────────────────────────────────────────
