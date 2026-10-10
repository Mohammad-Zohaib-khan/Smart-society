import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'sage' | 'terracotta' | 'forest' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  sage: 'bg-sage-soft text-sage-ink border-sage/30',
  terracotta: 'bg-terracotta-soft text-terracotta-ink border-terracotta/30',
  forest: 'bg-primary text-primary-foreground border-transparent',
  warning: 'bg-warning-soft text-warning-ink border-warning-ink/20',
  danger: 'bg-danger-soft text-danger border-danger/25',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8rem] font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}
