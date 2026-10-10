import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogDto, Paginated } from '@smart-society/shared';
import { api, qs } from '@/lib/api';
import { fmt } from '@/lib/format';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Input, Select } from '@/components/ui/field';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

const AREAS = [
  ['', 'Every area'],
  ['visitors', 'Visitors & gate'],
  ['complaints', 'Complaints'],
  ['members', 'Members'],
  ['parking', 'Parking'],
  ['vehicles', 'Vehicles'],
  ['bookings', 'Bookings'],
  ['amenities', 'Amenities'],
  ['announcements', 'Notices'],
  ['structure', 'Buildings & homes'],
  ['society', 'Settings'],
  ['reports', 'Exports'],
  ['auth', 'Sign-in & passwords'],
] as const;

export function AuditPage() {
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', action, search, from, to, page],
    queryFn: () => api.get<Paginated<AuditLogDto>>(`/audit${qs({ action, q: search, from, to, page, pageSize: 30 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <RequirePermission any={['audit.view']}>
      <PageHeader title="Audit log" description="A permanent record of significant actions: who did what, and when." />
      <Panel>
        <div className="flex flex-wrap gap-3 p-6 pb-2">
          <Select aria-label="Area" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} className="w-auto">
            {AREAS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input aria-label="Search" placeholder="Search descriptions" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
          <Input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} className="w-auto" />
          <Input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} className="w-auto" />
        </div>
        <QueryView query={q}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="No matching entries" />
            ) : (
              <>
                <Table className="mt-2">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Who</Th>
                      <Th>What</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((a) => (
                      <tr key={a.id}>
                        <Td className="tabular text-sm whitespace-nowrap">{fmt.dateTime(a.createdAt)}</Td>
                        <Td className="whitespace-nowrap">{a.actor?.name ?? 'System'}</Td>
                        <Td>
                          <span className="block">{a.summary}</span>
                          <span className="text-xs text-muted">{a.action}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </QueryView>
      </Panel>
    </RequirePermission>
  );
}
