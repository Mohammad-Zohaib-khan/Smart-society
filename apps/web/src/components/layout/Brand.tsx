import { Link } from 'react-router';
import { cn } from '@/lib/cn';

/** Arch-and-sprout mark: the gateway of a home with a growing shoot. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={cn('size-9', className)}>
      <rect width="40" height="40" rx="12" className="fill-primary" />
      <path d="M11 32V19a9 9 0 0 1 18 0v13" fill="none" className="stroke-clay" strokeWidth="2.4" />
      <path d="M20 29c0-5.5 3-8.5 7-9.8-.6 4.4-3.1 7.4-7 9.8Zm0 0c0-4.3-2.4-6.8-5.6-7.5.6 3.2 2.5 5.6 5.6 7.5Z" className="fill-sage" />
    </svg>
  );
}

export function Brand({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5 rounded-xl', className)}>
      <BrandMark />
      <span className="font-serif text-xl font-semibold tracking-tight">Smart Society</span>
    </Link>
  );
}
