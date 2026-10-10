import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';
import { ButtonLink, IconButton } from '@/components/ui/button';
import { Atmosphere } from '@/components/visual/Atmosphere';
import { SmoothScroll } from '@/components/visual/SmoothScroll';
import { useSession } from '@/hooks/useSession';
import { useThemeContext } from '@/providers';
import { cn } from '@/lib/cn';
import { STATIC_PREVIEW } from '@/lib/preview';

const links = [
  { to: '/#gate', label: 'At the gate' },
  { to: '/#upkeep', label: 'Upkeep' },
  { to: '/#privacy', label: 'Privacy' },
];

const EDITORIAL_PAGES = new Set(['/', '/privacy']);

export function PublicLayout() {
  const { pathname } = useLocation();
  // On the homepage the header floats over the cloud sky, so it switches to light text.
  const overSky = pathname === '/';
  const { dark } = useThemeContext();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(session.data);
  return (
    <div className="relative min-h-dvh">
      {/* One shared ShaderGradient instance, animated on the editorial pages. Sign-in and invitation
          pages use the static gradient derived from the same palette: they are often opened on
          mid-range phones (e.g. by guards at the gate), where a full WebGL scene costs too much. */}
      <Atmosphere live={EDITORIAL_PAGES.has(pathname)} dark={dark} />
      <div className="grain" aria-hidden />
      <SmoothScroll enabled />
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      {STATIC_PREVIEW && (
        <p role="note" className="relative z-40 bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
          Static preview of the public site. Signing in and the app need the API server — run the project locally to use them.
        </p>
      )}
      <header className="relative z-30">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Brand className={cn(overSky && 'text-white [text-shadow:0_1px_12px_rgb(15_40_70/0.35)]')} />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn(
                  'rounded-full px-4 py-2 text-[0.95rem] transition-colors duration-300',
                  overSky ? 'text-white/90 [text-shadow:0_1px_10px_rgb(15_40_70/0.4)] hover:text-white' : 'text-muted hover:text-foreground',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle className={cn(overSky && 'text-white hover:bg-white/15')} />
            <ButtonLink
              to={signedIn ? '/app' : '/login'}
              size="sm"
              variant="secondary"
              className={cn('hidden sm:inline-flex', overSky && 'border-transparent bg-white text-[#2d3a31] hover:bg-white/90')}
            >
              {signedIn ? 'Open your society' : 'Sign in'}
            </ButtonLink>
            <IconButton label={open ? 'Close menu' : 'Open menu'} className={cn('md:hidden', overSky && 'text-white hover:bg-white/15')} aria-expanded={open} aria-controls="public-menu" onClick={() => setOpen((o) => !o)}>
              {open ? <X className="size-5" strokeWidth={1.5} /> : <Menu className="size-5" strokeWidth={1.5} />}
            </IconButton>
          </div>
        </div>
        <nav id="public-menu" aria-label="Main" className={cn('mx-5 rounded-3xl border border-border bg-surface p-3 shadow-lift md:hidden', open ? 'block' : 'hidden')}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-2xl px-4 hover:bg-surface-2">
              {l.label}
            </Link>
          ))}
          <Link to={signedIn ? '/app' : '/login'} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-2xl px-4 font-medium text-terracotta-ink hover:bg-surface-2">
            {signedIn ? 'Open your society' : 'Sign in'}
          </Link>
        </nav>
      </header>
      <main id="main" className="relative z-10">
        <Outlet />
      </main>
      <footer className="relative z-10 border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Smart Society — software for running a residential community.</p>
          <nav aria-label="Footer" className="flex gap-5">
            <NavLink to="/privacy" className="hover:text-foreground">
              Privacy
            </NavLink>
            <NavLink to="/login" className="hover:text-foreground">
              Sign in
            </NavLink>
          </nav>
        </div>
      </footer>
    </div>
  );
}
