import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { NotificationDto, Paginated } from '@smart-society/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';

export function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', filter, page],
    queryFn: () => api.get<Paginated<NotificationDto>>(`/notifications${qs({ unread: filter === 'unread' ? 1 : undefined, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: invalidate });
  const readAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      toast.success(r.updated ? `Marked ${r.updated} as read` : 'Nothing unread');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Notifications" description="Updates about your visitors, complaints, bookings and notices." actions={<Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</Button>} />
      <Segmented label="Show" className="mb-6" value={filter} onChange={(v) => (setFilter(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
      <Panel>
        <QueryView query={q}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title={filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}>Notifications appear here as things happen in your society.</EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-border/70">
                  {data.items.map((n) => {
                    const body = (
                      <>
                        <span className="flex items-start gap-3">
                          <span className={cn('mt-2 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-terracotta')} aria-hidden />
                          <span className="min-w-0">
                            <span className={cn('block', !n.readAt && 'font-semibold')}>
                              {!n.readAt && <span className="sr-only">Unread: </span>}
                              {n.title}
                            </span>
                            <span className="block text-muted">{n.body}</span>
                            <span className="text-sm text-muted">{fmt.relative(n.createdAt)}</span>
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={n.id}>
                        {n.link ? (
                          <Link to={n.link} onClick={() => !n.readAt && readOne.mutate(n.id)} className="block px-6 py-4 hover:bg-surface-2/60">
                            {body}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => !n.readAt && readOne.mutate(n.id)} className="block w-full px-6 py-4 text-left hover:bg-surface-2/60">
                            {body}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </QueryView>
      </Panel>
    </>
  );
}
