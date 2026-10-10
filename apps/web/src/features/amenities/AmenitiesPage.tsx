import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Clock, MapPin, Plus, Users } from 'lucide-react';
import { amenitySchema, type AmenityDto, type AmenityInput, type BookingDto, type Paginated, type SlotAvailability } from '@smart-society/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { addDays, fmt, todayLocal } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

const REASON: Record<string, string> = { full: 'Full', past: 'Past', too_far: 'Not open yet', inactive: 'Closed' };

function useAmenities() {
  return useQuery({ queryKey: ['amenities'], queryFn: () => api.get<AmenityDto[]>('/amenities') });
}

function BookingPicker({ amenities }: { amenities: AmenityDto[] }) {
  const qc = useQueryClient();
  const active = amenities.filter((a) => a.active);
  const [amenityId, setAmenityId] = useState(active[0]?.id ?? '');
  const amenity = active.find((a) => a.id === amenityId) ?? active[0];
  const [date, setDate] = useState(todayLocal());
  const [pending, setPending] = useState<SlotAvailability | null>(null);
  const days = useMemo(() => Array.from({ length: (amenity?.maxAdvanceDays ?? 0) + 1 }, (_, i) => addDays(todayLocal(), i)), [amenity?.maxAdvanceDays]);
  const slots = useQuery({
    queryKey: ['availability', amenity?.id, date],
    queryFn: () => api.get<SlotAvailability[]>(`/amenities/${amenity?.id}/availability${qs({ date })}`),
    enabled: Boolean(amenity),
    refetchInterval: 30_000,
  });
  const book = useMutation({
    mutationFn: (s: SlotAvailability) => api.post<BookingDto>('/amenities/bookings', { amenityId: amenity?.id, slotStart: s.start }),
    onSuccess: (b) => {
      toast.success(`${b.amenityName} booked for ${fmt.dateShort(b.slotStart)}, ${fmt.time(b.slotStart)}`);
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['availability'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });

  if (!amenity) return <EmptyState title="No amenities open for booking">The society office hasn’t set up any bookable amenities yet.</EmptyState>;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <div role="radiogroup" aria-label="Amenity" className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {active.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={a.id === amenity.id}
            onClick={() => (setAmenityId(a.id), setDate(todayLocal()))}
            className={cn(
              'min-w-56 rounded-3xl border p-5 text-left transition-[border-color,background-color,box-shadow] duration-300',
              a.id === amenity.id ? 'border-sage bg-sage-soft shadow-soft' : 'border-border bg-surface hover:border-sage/60',
            )}
          >
            <span className="block font-serif text-xl">{a.name}</span>
            <span className="mt-1 block text-sm text-muted">
              {a.openTime}–{a.closeTime}, {a.slotMinutes >= 60 ? `${a.slotMinutes / 60} h` : `${a.slotMinutes} min`} slots
            </span>
          </button>
        ))}
      </div>

      <Panel>
        <div className="p-6">
          <h2 className="text-2xl">{amenity.name}</h2>
          {amenity.description && <p className="mt-1 max-w-prose text-muted">{amenity.description}</p>}
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {amenity.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" strokeWidth={1.5} />
                {amenity.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" strokeWidth={1.5} />
              {amenity.capacity} {amenity.capacity === 1 ? 'household' : 'households'} per slot
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" strokeWidth={1.5} />
              Cancel up to {amenity.cancellationCutoffHours} h before
            </span>
          </p>
        </div>
        <div role="radiogroup" aria-label="Day" className="flex gap-2 overflow-x-auto border-y border-border px-6 py-4" data-lenis-prevent>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === date}
              onClick={() => setDate(d)}
              className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm', d === date ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-sage')}
            >
              {d === todayLocal() ? 'Today' : fmt.calendarDate(d)}
            </button>
          ))}
        </div>
        <div className="p-6">
          {slots.isPending ? (
            <ListSkeleton rows={2} />
          ) : slots.isError ? (
            <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
          ) : slots.data.length === 0 ? (
            <p className="text-muted">No slots on this day.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {slots.data.map((s) => (
                <li key={s.start}>
                  <button
                    type="button"
                    disabled={!s.bookable || s.mine}
                    onClick={() => setPending(s)}
                    className={cn(
                      'flex w-full flex-col items-start rounded-2xl border px-4 py-3 text-left transition-colors duration-300',
                      s.mine ? 'border-sage bg-sage-soft' : s.bookable ? 'border-border-strong hover:border-terracotta hover:bg-terracotta-soft/50' : 'cursor-not-allowed border-border bg-surface-2 text-muted',
                    )}
                  >
                    <span className="tabular font-medium">
                      {fmt.time(s.start)}–{fmt.time(s.end)}
                    </span>
                    <span className="text-sm">{s.mine ? 'Your booking' : s.bookable ? `${s.capacity - s.booked} of ${s.capacity} free` : REASON[s.reason ?? ''] ?? 'Unavailable'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Book ${amenity.name}?`}
        description={pending ? `${fmt.weekdayDate(pending.start)}, ${fmt.time(pending.start)}–${fmt.time(pending.end)}. You can cancel until ${amenity.cancellationCutoffHours} hours before.` : ''}
        confirmLabel="Confirm booking"
        tone="primary"
        loading={book.isPending}
        onConfirm={() => pending && book.mutate(pending)}
      />
    </div>
  );
}

function BookingsList({ all }: { all: boolean }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [page, setPage] = useState(1);
  const [date, setDate] = useState('');
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  const q = useQuery({
    queryKey: ['bookings', scope, page, date],
    queryFn: () => api.get<Paginated<BookingDto>>(`/amenities/bookings${qs({ scope: date ? 'all' : scope, page, pageSize: 15, date })}`),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post<BookingDto>(`/amenities/bookings/${id}/cancel`),
    onSuccess: () => {
      toast.success('Booking cancelled — the slot is free again');
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel>
      <PanelHeader
        title={all ? 'All bookings' : 'Your bookings'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {all && <Input type="date" aria-label="Filter by day" value={date} onChange={(e) => (setDate(e.target.value), setPage(1))} className="w-auto" />}
            <Segmented label="Bookings" value={scope} onChange={(v) => (setScope(v), setPage(1), setDate(''))} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past & cancelled' }]} />
          </div>
        }
      />
      <QueryView query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No bookings">{scope === 'upcoming' ? 'Pick a slot above to book.' : 'Finished and cancelled bookings show here.'}</EmptyState>
          ) : (
            <>
              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th>Amenity</Th>
                    <Th>When</Th>
                    {all && <Th>Home</Th>}
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => (
                    <tr key={b.id}>
                      <Td>{b.amenityName}</Td>
                      <Td className="tabular">
                        {fmt.dateShort(b.slotStart)}, {fmt.time(b.slotStart)}–{fmt.time(b.slotEnd)}
                      </Td>
                      {all && <Td>{b.unitLabel}</Td>}
                      <Td>{b.status === 'cancelled' ? <Badge>Cancelled</Badge> : <Badge tone="sage">Confirmed</Badge>}</Td>
                      <Td className="text-right">
                        {b.canCancel && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(b)}>
                            Cancel
                          </Button>
                        )}
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
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this booking?"
        description={cancelling ? `${cancelling.amenityName}, ${fmt.dateShort(cancelling.slotStart)} at ${fmt.time(cancelling.slotStart)}${all ? `, booked by ${cancelling.unitLabel}. They’ll be notified.` : '.'}` : ''}
        confirmLabel="Cancel booking"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </Panel>
  );
}

const emptyAmenity: AmenityInput = {
  name: '',
  description: '',
  location: '',
  openTime: '06:00',
  closeTime: '22:00',
  slotMinutes: 60,
  capacity: 1,
  maxAdvanceDays: 7,
  maxActiveBookingsPerUnit: 2,
  cancellationCutoffHours: 2,
  active: true,
};

function AmenityDialog({ amenity, open, onOpenChange }: { amenity: AmenityDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<AmenityInput>({
    resolver: zodResolver(amenitySchema),
    values: amenity ? { ...amenity, location: amenity.location ?? '' } : emptyAmenity,
  });
  const m = useMutation({
    mutationFn: (v: AmenityInput) => (amenity ? api.patch(`/amenities/${amenity.id}`, v) : api.post('/amenities', v)),
    onSuccess: () => {
      toast.success(amenity ? 'Amenity updated' : 'Amenity added');
      void qc.invalidateQueries({ queryKey: ['amenities'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, Object.keys(emptyAmenity)),
  });
  const e = form.formState.errors;
  const num = (name: keyof AmenityInput) => form.register(name, { valueAsNumber: true });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={amenity ? `Edit ${amenity.name}` : 'Add an amenity'} description="Opening hours and slot length can’t change while future bookings exist." wide>
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Location" optional error={e.location?.message}>
            <Input {...form.register('location')} />
          </Field>
        </div>
        <Field label="Description" optional error={e.description?.message}>
          <Textarea rows={2} className="min-h-20" {...form.register('description')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" error={e.openTime?.message}>
            <Input type="time" {...form.register('openTime')} />
          </Field>
          <Field label="Closes" error={e.closeTime?.message}>
            <Input type="time" {...form.register('closeTime')} />
          </Field>
          <Field label="Slot length (minutes)" error={e.slotMinutes?.message}>
            <Input type="number" min={15} step={15} {...num('slotMinutes')} />
          </Field>
          <Field label="Households per slot" error={e.capacity?.message}>
            <Input type="number" min={1} {...num('capacity')} />
          </Field>
          <Field label="Book up to (days ahead)" error={e.maxAdvanceDays?.message}>
            <Input type="number" min={0} {...num('maxAdvanceDays')} />
          </Field>
          <Field label="Upcoming bookings per home" error={e.maxActiveBookingsPerUnit?.message}>
            <Input type="number" min={1} {...num('maxActiveBookingsPerUnit')} />
          </Field>
          <Field label="Resident cancel cut-off (hours)" error={e.cancellationCutoffHours?.message}>
            <Input type="number" min={0} {...num('cancellationCutoffHours')} />
          </Field>
        </div>
        <Checkbox label="Open for booking" description="Unticked amenities are hidden from residents." {...form.register('active')} />
        <Button type="submit" loading={m.isPending}>
          {amenity ? 'Save changes' : 'Add amenity'}
        </Button>
      </form>
    </Dialog>
  );
}

function ManageAmenities({ amenities }: { amenities: AmenityDto[] }) {
  const [editing, setEditing] = useState<AmenityDto | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <Panel>
      <PanelHeader title="Amenities" description="Hours, capacity and booking rules." action={<Button size="sm" onClick={() => (setEditing(null), setOpen(true))}><Plus className="size-4" />Add amenity</Button>} />
      {amenities.length === 0 ? (
        <EmptyState title="No amenities yet">Add the clubhouse, courts or pool so residents can book them.</EmptyState>
      ) : (
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Hours</Th>
              <Th>Per slot</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {amenities.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td className="tabular">
                  {a.openTime}–{a.closeTime} ({a.slotMinutes} min)
                </Td>
                <Td className="tabular">{a.capacity}</Td>
                <Td>{a.active ? <Badge tone="sage">Open</Badge> : <Badge>Closed</Badge>}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => (setEditing(a), setOpen(true))}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <AmenityDialog amenity={editing} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

export function AmenitiesPage() {
  const can = useCan();
  const amenities = useAmenities();
  const manager = can('amenities.manage');
  const [tab, setTab] = useState<'bookings' | 'manage'>('bookings');
  return (
    <RequirePermission any={['amenities.view']}>
      <PageHeader title="Amenities" description={can('amenities.book') ? 'Book shared spaces for your household.' : 'Bookings across the society and the rules behind them.'} />
      {manager && <Segmented label="View" className="mb-6" value={tab} onChange={setTab} options={[{ value: 'bookings', label: 'Bookings' }, { value: 'manage', label: 'Manage amenities' }]} />}
      <QueryView query={amenities}>
        {(list) => (
          <div className="space-y-8">
            {can('amenities.book') && <BookingPicker amenities={list} />}
            {manager && tab === 'manage' ? <ManageAmenities amenities={list} /> : (can('amenities.book') || can('bookings.viewAll')) && <BookingsList all={can('bookings.viewAll')} />}
          </div>
        )}
      </QueryView>
    </RequirePermission>
  );
}
