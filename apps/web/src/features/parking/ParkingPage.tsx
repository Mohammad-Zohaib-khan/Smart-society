import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Car, Plus } from 'lucide-react';
import {
  SLOT_TYPES,
  VEHICLE_TYPES,
  parkingSlotSchema,
  vehicleSchema,
  vehicleFitsSlot,
  type Paginated,
  type ParkingAssignmentDto,
  type ParkingSlotDto,
  type VehicleDto,
  type VehicleInput,
} from '@smart-society/shared';
import type { z } from 'zod';
import { api, errorMessage, qs } from '@/lib/api';
import { fmt } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

const VEHICLE_LABEL: Record<string, string> = { car: 'Car', two_wheeler: 'Two-wheeler', ev_car: 'Electric car', other: 'Other' };
const SLOT_LABEL: Record<string, string> = { car: 'Car', two_wheeler: 'Two-wheeler', ev: 'EV charging', visitor: 'Visitor' };

function VehicleDialog({ vehicle, open, onOpenChange }: { vehicle: VehicleDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<VehicleInput>({
    resolver: zodResolver(vehicleSchema),
    values: vehicle ? { registrationNumber: vehicle.registrationNumber, type: vehicle.type, make: vehicle.make ?? '', model: vehicle.model ?? '', color: vehicle.color ?? '' } : { registrationNumber: '', type: 'car', make: '', model: '', color: '' },
  });
  const m = useMutation({
    mutationFn: (v: VehicleInput) => (vehicle ? api.patch(`/parking/vehicles/${vehicle.id}`, v) : api.post('/parking/vehicles', v)),
    onSuccess: () => {
      toast.success(vehicle ? 'Vehicle updated' : 'Vehicle registered');
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['registrationNumber', 'type', 'make', 'model', 'color']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={vehicle ? 'Edit vehicle' : 'Register a vehicle'} description="Registered vehicles can be given a parking slot and are recognised at the gate.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Registration number" hint="As on the number plate, e.g. MH 12 AB 1234" error={e.registrationNumber?.message}>
          <Input autoCapitalize="characters" {...form.register('registrationNumber')} />
        </Field>
        <Field label="Type">
          <Select {...form.register('type')}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {VEHICLE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Make" optional>
            <Input {...form.register('make')} />
          </Field>
          <Field label="Model" optional>
            <Input {...form.register('model')} />
          </Field>
          <Field label="Colour" optional>
            <Input {...form.register('color')} />
          </Field>
        </div>
        <Button type="submit" loading={m.isPending}>
          {vehicle ? 'Save' : 'Register vehicle'}
        </Button>
      </form>
    </Dialog>
  );
}

function MyVehicles() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vehicles', 'mine'], queryFn: () => api.get<Paginated<VehicleDto>>('/parking/vehicles?pageSize=20') });
  const [editing, setEditing] = useState<VehicleDto | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<VehicleDto | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/parking/vehicles/${id}`),
    onSuccess: () => {
      toast.success('Vehicle removed');
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Vehicles & parking" description="Your household’s vehicles and the slots the society has assigned." actions={<Button onClick={() => (setEditing(null), setOpen(true))}><Plus className="size-4" />Register a vehicle</Button>} />
      <QueryView query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <Panel>
              <EmptyState title="No vehicles registered" action={<Button size="sm" onClick={() => setOpen(true)}>Register a vehicle</Button>}>
                Register your vehicles so the office can assign a slot and guards can recognise them.
              </EmptyState>
            </Panel>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((v) => (
                <li key={v.id}>
                  <Panel className="flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-sage-soft text-sage-ink">
                        <Car className="size-5" strokeWidth={1.5} />
                      </span>
                      {v.slotCode ? <Badge tone="sage">Slot {v.slotCode}</Badge> : <Badge>No slot yet</Badge>}
                    </div>
                    <p className="tabular mt-4 text-2xl font-semibold tracking-wider">{v.registrationNumber}</p>
                    <p className="text-muted">{[VEHICLE_LABEL[v.type], v.color, v.make, v.model].filter(Boolean).join(', ')}</p>
                    <div className="mt-auto flex gap-1 pt-4">
                      <Button size="sm" variant="ghost" onClick={() => (setEditing(v), setOpen(true))}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={Boolean(v.slotCode)} title={v.slotCode ? 'Ask the office to release the slot first' : undefined} onClick={() => setRemoving(v)}>
                        Remove
                      </Button>
                    </div>
                  </Panel>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      <p className="mt-6 text-sm text-muted">Parking slots are allocated by the society office. Contact them to request or change a slot.</p>
      <VehicleDialog vehicle={editing} open={open} onOpenChange={setOpen} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title="Remove this vehicle?" description={removing ? `${removing.registrationNumber} will no longer be recognised at the gate.` : ''} confirmLabel="Remove vehicle" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </>
  );
}

type SlotInput = z.input<typeof parkingSlotSchema>;

function SlotDialog({ slot, open, onOpenChange }: { slot: ParkingSlotDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<SlotInput>({
    resolver: zodResolver(parkingSlotSchema),
    values: slot ? { code: slot.code, type: slot.type, level: slot.level ?? '', active: slot.active } : { code: '', type: 'car', level: '', active: true },
  });
  const m = useMutation({
    mutationFn: (v: SlotInput) => (slot ? api.patch(`/parking/slots/${slot.id}`, v) : api.post('/parking/slots', v)),
    onSuccess: () => {
      toast.success(slot ? 'Slot updated' : 'Slot added');
      void qc.invalidateQueries({ queryKey: ['slots'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['code', 'type', 'level']),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={slot ? `Edit ${slot.code}` : 'Add a parking slot'}>
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Slot code" error={form.formState.errors.code?.message}>
            <Input {...form.register('code')} />
          </Field>
          <Field label="Level" optional>
            <Input placeholder="e.g. Basement 1" {...form.register('level')} />
          </Field>
        </div>
        <Field label="Type">
          <Select {...form.register('type')}>
            {SLOT_TYPES.map((t) => (
              <option key={t} value={t}>
                {SLOT_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox label="In use" description="Inactive slots can’t be assigned." {...form.register('active')} />
        <Button type="submit" loading={m.isPending}>
          {slot ? 'Save' : 'Add slot'}
        </Button>
      </form>
    </Dialog>
  );
}

function AssignDialog({ slot, onClose }: { slot: ParkingSlotDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const vehicles = useQuery({
    queryKey: ['vehicles', 'search', search],
    queryFn: () => api.get<Paginated<VehicleDto>>(`/parking/vehicles${qs({ q: search, pageSize: 20 })}`),
    enabled: Boolean(slot),
  });
  const m = useMutation({
    mutationFn: (vehicleId: string) => api.post(`/parking/slots/${slot?.id}/assign`, { vehicleId }),
    onSuccess: () => {
      toast.success(`Slot ${slot?.code} assigned — the household is notified`);
      void qc.invalidateQueries({ queryKey: ['slots'] });
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const candidates = (vehicles.data?.items ?? []).filter((v) => slot && vehicleFitsSlot(v.type, slot.type));
  return (
    <Dialog open={Boolean(slot)} onOpenChange={(o) => !o && onClose()} title={`Assign ${slot?.code ?? ''}`} description={slot ? `${SLOT_LABEL[slot.type]} slot. Only vehicles that fit are listed.` : ''}>
      <Input aria-label="Search registration" placeholder="Search registration" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto" data-lenis-prevent>
        {candidates.length === 0 && <li className="text-sm text-muted">No matching vehicles.</li>}
        {candidates.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3">
            <span>
              <span className="tabular block font-medium">{v.registrationNumber}</span>
              <span className="text-sm text-muted">
                {v.unitLabel}, {VEHICLE_LABEL[v.type]}
                {v.slotCode ? `, already in ${v.slotCode}` : ''}
              </span>
            </span>
            <Button size="sm" disabled={Boolean(v.slotCode)} loading={m.isPending && m.variables === v.id} onClick={() => m.mutate(v.id)}>
              Assign
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function SlotsBoard() {
  const qc = useQueryClient();
  const [occupancy, setOccupancy] = useState<'' | 'free' | 'occupied'>('');
  const [editing, setEditing] = useState<ParkingSlotDto | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [assigning, setAssigning] = useState<ParkingSlotDto | null>(null);
  const [releasing, setReleasing] = useState<ParkingSlotDto | null>(null);
  const q = useQuery({ queryKey: ['slots', occupancy], queryFn: () => api.get<ParkingSlotDto[]>(`/parking/slots${qs({ occupancy })}`) });
  const release = useMutation({
    mutationFn: (id: string) => api.post(`/parking/slots/${id}/release`),
    onSuccess: () => {
      toast.success('Slot released');
      setReleasing(null);
      void qc.invalidateQueries({ queryKey: ['slots'] });
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel>
      <PanelHeader
        title="Slots"
        action={
          <div className="flex flex-wrap gap-2">
            <Segmented label="Occupancy" value={occupancy} onChange={setOccupancy} options={[{ value: '', label: 'All' }, { value: 'free', label: 'Free' }, { value: 'occupied', label: 'Taken' }]} />
            <Button size="sm" onClick={() => (setEditing(null), setSlotOpen(true))}>
              <Plus className="size-4" />
              Add slot
            </Button>
          </div>
        }
      />
      <QueryView query={q}>
        {(slots) =>
          slots.length === 0 ? (
            <EmptyState title="No slots">Add the society’s parking slots to start allocating them.</EmptyState>
          ) : (
            <ul className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
              {slots.map((s) => (
                <li key={s.id} className={cn('rounded-3xl border p-4', !s.active ? 'border-dashed border-border bg-surface-2 opacity-70' : s.assignment ? 'border-sage/50 bg-sage-soft/60' : 'border-border')}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="tabular text-lg font-semibold">{s.code}</p>
                      <p className="text-sm text-muted">
                        {SLOT_LABEL[s.type]}
                        {s.level ? `, ${s.level}` : ''}
                      </p>
                    </div>
                    {!s.active ? <Badge>Inactive</Badge> : s.assignment ? <Badge tone="sage">{s.assignment.unitLabel}</Badge> : <Badge tone="terracotta">Free</Badge>}
                  </div>
                  {s.assignment && (
                    <p className="tabular mt-3 text-sm">
                      {s.assignment.registrationNumber} <span className="text-muted">since {fmt.date(s.assignment.since)}</span>
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.active && s.type !== 'visitor' && !s.assignment && (
                      <Button size="sm" variant="secondary" onClick={() => setAssigning(s)}>
                        Assign
                      </Button>
                    )}
                    {s.assignment && (
                      <Button size="sm" variant="secondary" onClick={() => setReleasing(s)}>
                        Release
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => (setEditing(s), setSlotOpen(true))}>
                      Edit
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      <SlotDialog slot={editing} open={slotOpen} onOpenChange={setSlotOpen} />
      <AssignDialog slot={assigning} onClose={() => setAssigning(null)} />
      <ConfirmDialog open={Boolean(releasing)} onOpenChange={(o) => !o && setReleasing(null)} title={`Release ${releasing?.code ?? ''}?`} description={releasing?.assignment ? `${releasing.assignment.registrationNumber} (${releasing.assignment.unitLabel}) will lose this slot. The household is notified.` : ''} confirmLabel="Release slot" loading={release.isPending} onConfirm={() => releasing && release.mutate(releasing.id)} />
    </Panel>
  );
}

function AllVehicles() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['vehicles', 'all', page, search], queryFn: () => api.get<Paginated<VehicleDto>>(`/parking/vehicles${qs({ page, q: search, pageSize: 20 })}`), placeholderData: keepPreviousData });
  return (
    <Panel>
      <PanelHeader title="Registered vehicles" action={<Input aria-label="Search registration" placeholder="Search registration" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="w-56" />} />
      <QueryView query={q}>
        {(data) => (
          <>
            <Table className="mt-4">
              <thead>
                <tr>
                  <Th>Registration</Th>
                  <Th>Home</Th>
                  <Th>Type</Th>
                  <Th>Slot</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => (
                  <tr key={v.id}>
                    <Td className="tabular font-medium">{v.registrationNumber}</Td>
                    <Td>{v.unitLabel}</Td>
                    <Td>{VEHICLE_LABEL[v.type]}</Td>
                    <Td>{v.slotCode ?? <span className="text-muted">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {data.items.length === 0 && <p className="p-6 text-muted">No vehicles registered.</p>}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryView>
    </Panel>
  );
}

function History() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['assignments', page], queryFn: () => api.get<Paginated<ParkingAssignmentDto>>(`/parking/assignments${qs({ page })}`), placeholderData: keepPreviousData });
  return (
    <Panel>
      <PanelHeader title="Assignment history" />
      <QueryView query={q}>
        {(data) => (
          <>
            <Table className="mt-4">
              <thead>
                <tr>
                  <Th>Slot</Th>
                  <Th>Vehicle</Th>
                  <Th>Home</Th>
                  <Th>From</Th>
                  <Th>Until</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <Td className="tabular">{a.slotCode}</Td>
                    <Td className="tabular">{a.registrationNumber}</Td>
                    <Td>{a.unitLabel}</Td>
                    <Td className="text-sm">
                      {fmt.date(a.startedAt)} <span className="text-muted">by {a.assignedBy.name}</span>
                    </Td>
                    <Td className="text-sm">{a.endedAt ? fmt.date(a.endedAt) : <Badge tone="sage">Current</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {data.items.length === 0 && <p className="p-6 text-muted">No assignments yet.</p>}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </QueryView>
    </Panel>
  );
}

function ParkingAdmin() {
  const [tab, setTab] = useState<'slots' | 'vehicles' | 'history'>('slots');
  return (
    <>
      <PageHeader title="Parking" description="Allocate slots to residents’ vehicles. A slot holds one vehicle and a vehicle holds one slot." />
      <Segmented label="View" className="mb-6" value={tab} onChange={setTab} options={[{ value: 'slots', label: 'Slots' }, { value: 'vehicles', label: 'Vehicles' }, { value: 'history', label: 'History' }]} />
      {tab === 'slots' ? <SlotsBoard /> : tab === 'vehicles' ? <AllVehicles /> : <History />}
    </>
  );
}

export function ParkingPage() {
  const can = useCan();
  return <RequirePermission any={['vehicles.manageOwn', 'parking.manage']}>{can('parking.manage') ? <ParkingAdmin /> : <MyVehicles />}</RequirePermission>;
}

