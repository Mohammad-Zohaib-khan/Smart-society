import { Component, lazy, Suspense, useMemo, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useMedia';
import { cn } from '@/lib/cn';

/** The heavy WebGL stack (three + r3f + shadergradient) is split out and only loaded here. */
const ShaderGradientLayer = lazy(() => import('./ShaderGradientLayer'));

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn('ShaderGradient failed; showing the static atmosphere instead.', error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Fixed atmospheric background. `live` mounts the animated ShaderGradient (public pages);
 * otherwise, and whenever WebGL or motion is unavailable, a static gradient derived from the
 * same palette is used. Only one instance is ever mounted (it lives in the public layout).
 */
export function Atmosphere({ live, dark }: { live: boolean; dark: boolean }) {
  const reduced = useReducedMotion();
  const canRender = useMemo(() => live && webglAvailable(), [live]);
  const fallback = <div className="atmosphere-static absolute inset-0" />;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {fallback}
      {canRender && (
        <Fallback fallback={null}>
          <Suspense fallback={null}>
            {/* Light theme: the cool plane reads as morning air over alabaster. Dark theme: the pale
                plane is blended with soft-light so it tints the night palette instead of greying it. */}
            <div className={cn('absolute inset-0 transition-opacity duration-1000', dark ? 'opacity-40 mix-blend-soft-light' : 'opacity-55')}>
              <ShaderGradientLayer animate={!reduced} />
            </div>
          </Suspense>
        </Fallback>
      )}
    </div>
  );
}
