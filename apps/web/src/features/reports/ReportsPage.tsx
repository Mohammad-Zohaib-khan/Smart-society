import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { COMPLAINT_STATUS_LABELS, type ComplaintStatus, type CountByKey, type ReportSummary } from '@smart-society/shared';
import { api, apiUrl, qs } from '@/lib/api';
import { addDays, fmt, todayLocal } from '@/lib/format';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader, Stat } from '@/components/ui/panel';
import { buttonClass } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { QueryView, Skeleton } from '@/components/ui/states';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

/** Daily visitor columns. The data table beneath it is the accessible equivalent. */
function DailyBars({ data }: { data: CountByKey[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  const busiest = data.reduce((a, b) => (b.count > a.count ? b : a), data[0] ?? { key: '', count: 0 });
  // Label roughly six evenly spaced days so labels never collide.
  const step = Math.max(1, Math.ceil(data.length / 6));
  return (
    <figure>
      <div
        role="img"
        aria-label={`Visitors per day: ${total} in total, busiest ${busiest.key ? fmt.calendarDate(busiest.key) : 'n/a'} with ${busiest.count}.`}
        className="relative flex h-48 items-end gap-[3px] border-b border-border bg-[linear-gradient(to_top,transparent_calc(50%-0.5px),var(--border)_50%,transparent_calc(50%+0.5px))] sm:gap-1.5"
      >
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 items-end" title={`${fmt.calendarDate(d.key)}: ${d.count}`}>
            <div className="w-full rounded-t-md bg-sage transition-colors duration-300 group-hover:bg-sage-ink" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px] text-[11px] text-muted sm:gap-1.5" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 overflow-visible whitespace-nowrap">
            {i % step === 0 ? fmt.calendarDate(d.key).split(' ').slice(1).join(' ') : ''}
          </span>
        ))}
      </div>
      <figcaption className="mt-3 text-sm text-muted">
        {total} visits in the period; busiest day {busiest.key ? `${fmt.calendarDate(busiest.key)} (${busiest.count})` : 'n/a'}.
      </figcaption>
    </figure>
  );
}

function Bars({ data, label }: { data: { key: string; count: number }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <p className="text-muted">No data in this period.</p>;
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate">{label(d.key)}</span>
          <span className="h-2.5 rounded-full bg-surface-2" aria-hidden>
            <span className="block h-full rounded-full bg-terracotta" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="tabular text-right">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReportsPage() {
  const can = useCan();
  const [to, setTo] = useState(todayLocal());
  const [from, setFrom] = useState(addDays(todayLocal(), -29));
  const q = useQuery({ queryKey: ['report', from, to], queryFn: () => api.get<ReportSummary>(`/reports/summary${qs({ from, to })}`), enabled: Boolean(from && to && from <= to) });
  const exportLink = (kind: string) => apiUrl(`/reports/export${qs({ kind, from, to })}`);
  return (
    <RequirePermission any={['reports.view']}>
      <PageHeader
        title="Reports"
        description="How the society has been running. Exports are recorded in the audit log."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
            <span className="text-muted">to</span>
            <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-auto" />
          </div>
        }
      />
      {from > to && <p className="mb-4 text-danger">The start date must be on or before the end date.</p>}
      <QueryView query={q} loading={<Skeleton className="h-96 rounded-3xl" />}>
        {(r) => (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Visits" value={r.visitorsPerDay.reduce((n, d) => n + d.count, 0)} detail={r.visitorsBySource.map((s) => `${s.count} ${s.key === 'walk_in' ? 'walk-in' : 'pre-approved'}`).join(', ') || 'none'} />
              <Stat label="Complaints raised" value={r.complaintsByStatus.reduce((n, d) => n + d.count, 0)} />
              <Stat label="Average time to resolve" value={r.averageResolutionHours === null ? '—' : r.averageResolutionHours < 48 ? `${r.averageResolutionHours} h` : `${Math.round(r.averageResolutionHours / 24)} d`} detail="For complaints resolved in the period" />
              <Stat label="Parking in use" value={`${r.parking.occupied}/${r.parking.slots}`} tone="calm" detail="Right now" />
            </div>
            <Panel>
              <PanelHeader title="Visitors per day" />
              <div className="p-6">
                <DailyBars data={r.visitorsPerDay} />
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-terracotta-ink">Show as a table</summary>
                  <Table className="mt-2">
                    <thead>
                      <tr>
                        <Th>Day</Th>
                        <Th>Visits</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.visitorsPerDay.map((d) => (
                        <tr key={d.key}>
                          <Td>{fmt.calendarDate(d.key)}</Td>
                          <Td className="tabular">{d.count}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </details>
              </div>
            </Panel>
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel>
                <PanelHeader title="Complaints by category" />
                <div className="p-6">
                  <Bars data={r.complaintsByCategory} label={(k) => k} />
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="Complaints by current status" />
                <div className="p-6">
                  <Bars data={r.complaintsByStatus} label={(k) => COMPLAINT_STATUS_LABELS[k as ComplaintStatus] ?? k} />
                </div>
              </Panel>
            </div>
            <Panel>
              <PanelHeader title="Amenity use" description="Confirmed bookings against the bookable capacity in the period." />
              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th>Amenity</Th>
                    <Th>Bookings</Th>
                    <Th>Capacity</Th>
                    <Th>Use</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.amenityUtilisation.map((a) => (
                    <tr key={a.amenity}>
                      <Td>{a.amenity}</Td>
                      <Td className="tabular">{a.bookings}</Td>
                      <Td className="tabular">{a.capacitySlots}</Td>
                      <Td className="tabular">{a.capacitySlots ? `${Math.round((a.bookings / a.capacitySlots) * 1000) / 10}%` : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {r.amenityUtilisation.length === 0 && <p className="p-6 text-muted">No amenities set up.</p>}
            </Panel>
            {can('reports.export') && (
              <Panel className="p-6">
                <h2 className="text-xl">Download the records</h2>
                <p className="mt-1 text-sm text-muted">CSV files for {fmt.calendarDate(r.range.from)} – {fmt.calendarDate(r.range.to)}. Visitor phone numbers are masked.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(['visits', 'complaints', 'bookings'] as const).map((k) => (
                    <a key={k} href={exportLink(k)} className={buttonClass('secondary', 'md')} download>
                      <Download className="size-4" strokeWidth={1.5} />
                      {k.charAt(0).toUpperCase() + k.slice(1)} CSV
                    </a>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}
      </QueryView>
    </RequirePermission>
  );
}
