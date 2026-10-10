import type { ReactNode } from 'react';
import { Panel } from '@/components/ui/panel';

/** Centered form card with a quiet arch motif beside it on wide screens. */
export function AuthFrame({ title, intro, children, aside }: { title: string; intro?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 pt-6 pb-20 sm:px-8 md:grid-cols-[1fr_minmax(0,26rem)] md:pt-12">
      <div className="hidden md:block">
        <div className="relative aspect-[4/5] max-w-sm overflow-hidden rounded-t-full border border-border bg-[linear-gradient(170deg,#e9eef4_0%,#f3f2f8_45%,#e5eadf_100%)] dark:bg-[linear-gradient(170deg,#1f2a2f_0%,#1c221e_60%,#26302a_100%)]">
          <svg viewBox="0 0 300 380" className="absolute inset-x-0 bottom-0 w-full text-sage" aria-hidden>
            <path d="M150 380c0-90 30-150 95-190-18 82-50 140-95 190Z" fill="currentColor" opacity=".55" />
            <path d="M150 380c0-70-26-120-82-150 10 64 38 115 82 150Z" fill="currentColor" opacity=".8" />
            <path d="M150 380V200" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
          {aside && <div className="absolute inset-x-8 top-16 text-center">{aside}</div>}
        </div>
      </div>
      <Panel className="p-7 sm:p-9">
        <h1 className="text-3xl">{title}</h1>
        {intro && <div className="mt-2 text-muted">{intro}</div>}
        <div className="mt-7">{children}</div>
      </Panel>
    </div>
  );
}
