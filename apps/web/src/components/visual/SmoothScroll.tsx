import { useEffect } from 'react';
import Lenis from 'lenis';
import { useLocation } from 'react-router';
import { useReducedMotion } from '@/hooks/useMedia';

/**
 * The single Lenis instance for the app. It runs only where `enabled` (public, long-form pages);
 * operational screens keep native scrolling. Reduced-motion users get native scrolling too.
 * Keyboard scrolling, anchors, focus and touch remain native — Lenis only smooths wheel input.
 */
export function SmoothScroll({ enabled }: { enabled: boolean }) {
  const reduced = useReducedMotion();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!enabled || reduced) return;
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.09,
      smoothWheel: true,
      anchors: { offset: -80 },
      stopInertiaOnNavigate: true,
      respectReducedMotion: true,
    });
    return () => lenis.destroy();
  }, [enabled, reduced]);

  // New route → start at the top, like a normal page load.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
