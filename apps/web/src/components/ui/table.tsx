import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto" data-lenis-prevent>
      <table className={cn('w-full border-collapse text-left text-[0.95rem]', className)} {...rest} />
    </div>
  );
}
export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('border-b border-border px-4 py-3 text-sm font-medium text-muted first:pl-6 last:pr-6', className)} {...rest} />;
}
export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-border/70 px-4 py-3 align-middle first:pl-6 last:pr-6', className)} {...rest} />;
}
