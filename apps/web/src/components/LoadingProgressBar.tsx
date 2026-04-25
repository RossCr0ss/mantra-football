'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a 0-100 percentage value and a `visible` flag.
 *
 * While `active`:
 *   - Waits `showAfterMs` before becoming visible (avoids a flash on fast cache hits).
 *   - Fake-progresses toward 88% with decelerating increments.
 *
 * When `active` goes false:
 *   - Jumps to 100, then hides after 450ms (time for the CSS fade-out).
 */
export function useProgressBar(
  active: boolean,
  showAfterMs = 250,
): { pct: number; visible: boolean } {
  const [pct, setPct]         = useState(0);
  const [visible, setVisible] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (active) {
      // Reset any in-flight hide timer from a previous load
      if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null; }

      setPct(0);

      // Delay before showing so fast cache hits never flash the bar
      showRef.current = setTimeout(() => setVisible(true), showAfterMs);

      // Decelerate toward 88% — never actually reaches it while loading
      tickRef.current = setInterval(() => {
        setPct((p) => p >= 88 ? p : p + Math.max(0.3, (88 - p) * 0.07));
      }, 160);
    } else {
      if (showRef.current) { clearTimeout(showRef.current); showRef.current = null; }
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }

      if (visible) {
        setPct(100);
        hideRef.current = setTimeout(() => {
          setVisible(false);
          setPct(0);
        }, 450);
      }
    }

    return () => {
      if (showRef.current) clearTimeout(showRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { pct, visible };
}

// ─── Progress bar component ───────────────────────────────────────────────────

/**
 * Thin (3 px) fixed bar at the very top of the viewport.
 * Pass `loading={true}` to start it, `loading={false}` to complete and fade out.
 *
 * Only rendered when visible — no DOM overhead on static pages.
 */
export function ProgressBar({ loading }: { loading: boolean }) {
  const { pct, visible } = useProgressBar(loading);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[5px]"
      aria-hidden
    >
      <div
        className="h-full bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400"
        style={{
          width: `${pct}%`,
          opacity: pct >= 100 ? 0 : 1,
          boxShadow: pct >= 100 ? 'none' : '0 0 14px 3px rgba(99,102,241,0.65)',
          transition:
            pct >= 100
              ? 'width 150ms ease-out, opacity 300ms 100ms ease-out'
              : 'width 200ms ease-out',
        }}
      />
    </div>
  );
}

// ─── Route-change indicator (used in root layout) ─────────────────────────────

/**
 * Automatically shows a brief progress bar whenever the Next.js route changes.
 * Drop this into the root layout — it self-manages entirely.
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const [active, setActive]   = useState(false);
  const prev                  = useRef(pathname);
  const doneRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pathname !== prev.current) {
      prev.current = pathname;
      if (doneRef.current) clearTimeout(doneRef.current);
      setActive(true);
      // Route transitions in App Router are fast — complete after a short delay
      doneRef.current = setTimeout(() => setActive(false), 600);
    }
    return () => { if (doneRef.current) clearTimeout(doneRef.current); };
  }, [pathname]);

  return <ProgressBar loading={active} />;
}
