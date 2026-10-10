import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './button';

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-sm text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <span className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-5" strokeWidth={1.5} />
        </IconButton>
        <span className="tabular px-1">
          {page} / {pages}
        </span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-5" strokeWidth={1.5} />
        </IconButton>
      </span>
    </nav>
  );
}
