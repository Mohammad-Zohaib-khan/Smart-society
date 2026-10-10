import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('rounded-3xl border border-border bg-surface shadow-soft', className)} {...rest} />;
}

export function PanelHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-6 pt-6', className)}>
      <div className="min-w-0">
        <h2 className="text-xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-3xl leading-tight sm:text-[2.5rem]">{title}</h1>
        {description && <p className="mt-2 text-[1.05rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, detail, tone = 'plain' }: { label: string; value: ReactNode; detail?: ReactNode; tone?: 'plain' | 'attention' | 'calm' }) {
  return (
    <div
      className={cn(
        'rounded-3xl border p-5',
        tone === 'attention' ? 'border-terracotta/40 bg-terracotta-soft' : tone === 'calm' ? 'border-sage/40 bg-sage-soft' : 'border-border bg-surface',
      )}
    >
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 font-serif text-4xl leading-none">{value}</p>
      {detail && <p className="mt-2 text-sm text-muted">{detail}</p>}
    </div>
  );
}
