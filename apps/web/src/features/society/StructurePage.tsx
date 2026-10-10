import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { buildingSchema, bulkUnitsSchema, unitSchema, type BuildingDto, type Paginated, type UnitDto } from '@smart-society/shared';
import type { z } from 'zod';
import { api, errorMessage, qs } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

type BuildingInput = z.input<typeof buildingSchema>;
type UnitInput = z.input<typeof unitSchema>;
type BulkInput = z.input<typeof bulkUnitsSchema>;

function BuildingDialog({ building, open, onOpenChange }: { building: BuildingDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<BuildingInput>({ resolver: zodResolver(buildingSchema), values: building ? { name: building.name, code: building.code, floors: building.floors } : { name: '', code: '', floors: 5 } });
  const m = useMutation({
    mutationFn: (v: BuildingInput) => (building ? api.patch(`/society/buildings/${building.id}`, { name: v.name, floors: v.floors }) : api.post('/society/buildings', v)),
    onSuccess: () => {
      toast.success(building ? 'Building updated' : 'Building added');
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['name', 'code', 'floors']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={building ? `Edit ${building.name}` : 'Add a building'} description="The code prefixes every home label, e.g. code “W” gives W-302. It can’t change later.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Name" error={e.name?.message}>
          <Input placeholder="Willow Tower" {...form.register('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" error={e.code?.message}>
            <Input disabled={Boolean(building)} {...form.register('code')} />
          </Field>
          <Field label="Floors" error={e.floors?.message}>
            <Input type="number" min={1} {...form.register('floors', { valueAsNumber: true })} />
          </Field>
        </div>
        <Button type="submit" loading={m.isPending}>
          {building ? 'Save' : 'Add building'}
        </Button>
      </form>
    </Dialog>
  );
}

function UnitDialog({ buildings, unit, open, onOpenChange }: { buildings: BuildingDto[]; unit: UnitDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<UnitInput>({
    resolver: zodResolver(unitSchema),
    values: unit ? { buildingId: unit.buildingId, number: unit.number, floor: unit.floor, type: unit.type ?? '', status: unit.status } : { buildingId: buildings[0]?.id ?? '', number: '', floor: 1, type: '', status: 'vacant' },
  });
  const m = useMutation({
    mutationFn: (v: UnitInput) => (unit ? api.patch(`/society/units/${unit.id}`, { number: v.number, floor: v.floor, type: v.type, status: v.status }) : api.post('/society/units', v)),
    onSuccess: () => {
      toast.success(unit ? 'Home updated' : 'Home added');
      void qc.invalidateQueries({ queryKey: ['units'] });
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['buildingId', 'number', 'floor', 'type', 'status']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={unit ? `Edit ${unit.label}` : 'Add a home'}>
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        {!unit && (
          <Field label="Building">
            <Select {...form.register('buildingId')}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Number" error={e.number?.message}>
            <Input {...form.register('number')} />
          </Field>
          <Field label="Floor" error={e.floor?.message}>
            <Input type="number" {...form.register('floor', { valueAsNumber: true })} />
          </Field>
          <Field label="Type" optional>
            <Input placeholder="2 BHK" {...form.register('type')} />
          </Field>
          <Field label="Status">
            <Select {...form.register('status')}>
              <option value="occupied">Occupied</option>
              <option value="vacant">Vacant</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" loading={m.isPending}>
          {unit ? 'Save' : 'Add home'}
        </Button>
      </form>
    </Dialog>
  );
}

function BulkDialog({ building, onClose }: { building: BuildingDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<BulkInput>({ resolver: zodResolver(bulkUnitsSchema), values: { buildingId: building?.id ?? '', fromFloor: 1, toFloor: building?.floors ?? 1, unitsPerFloor: 4 } });
  const v = form.watch();
  const count = Math.max(0, ((Number(v.toFloor) || 0) - (Number(v.fromFloor) || 0) + 1) * (Number(v.unitsPerFloor) || 0));
  const m = useMutation({
    mutationFn: (input: BulkInput) => api.post<{ created: number; skipped: number }>('/society/units/bulk', input),
    onSuccess: (r) => {
      toast.success(`${r.created} homes created${r.skipped ? `, ${r.skipped} already existed` : ''}`);
      void qc.invalidateQueries({ queryKey: ['units'] });
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      onClose();
    },
    onError: (e) => handleFormError(e, form.setError, ['fromFloor', 'toFloor', 'unitsPerFloor']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={Boolean(building)} onOpenChange={(o) => !o && onClose()} title={`Generate homes in ${building?.name ?? ''}`} description="Homes are numbered floor + position, e.g. floor 3, home 2 → 302. Existing numbers are skipped.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((input) => m.mutate(input))}>
        <div className="grid grid-cols-3 gap-4">
          <Field label="From floor" error={e.fromFloor?.message}>
            <Input type="number" min={0} {...form.register('fromFloor', { valueAsNumber: true })} />
          </Field>
          <Field label="To floor" error={e.toFloor?.message}>
            <Input type="number" min={0} {...form.register('toFloor', { valueAsNumber: true })} />
          </Field>
          <Field label="Per floor" error={e.unitsPerFloor?.message}>
            <Input type="number" min={1} {...form.register('unitsPerFloor', { valueAsNumber: true })} />
          </Field>
        </div>
        <Button type="submit" loading={m.isPending} disabled={count < 1}>
          Create {count} homes
        </Button>
      </form>
    </Dialog>
  );
}

export function StructurePage() {
  const can = useCan();
  const manage = can('structure.manage');
  const qc = useQueryClient();
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: () => api.get<BuildingDto[]>('/society/buildings') });
  const [buildingId, setBuildingId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingBuilding, setEditingBuilding] = useState<BuildingDto | null>(null);
  const [buildingOpen, setBuildingOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitDto | null>(null);
  const [unitOpen, setUnitOpen] = useState(false);
  const [bulkFor, setBulkFor] = useState<BuildingDto | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'building' | 'unit'; id: string; label: string } | null>(null);
  const units = useQuery({
    queryKey: ['units', buildingId, status, search, page],
    queryFn: () => api.get<Paginated<UnitDto>>(`/society/units${qs({ buildingId, status, q: search, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const del = useMutation({
    mutationFn: (d: { kind: 'building' | 'unit'; id: string }) => api.delete(`/society/${d.kind === 'building' ? 'buildings' : 'units'}/${d.id}`),
    onSuccess: () => {
      toast.success('Deleted');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['buildings'] });
      void qc.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <RequirePermission any={['structure.view']}>
      <PageHeader title="Buildings & homes" description="The physical layout every pass, booking and complaint refers to." actions={manage && <Button onClick={() => (setEditingBuilding(null), setBuildingOpen(true))}><Plus className="size-4" />Add building</Button>} />
      <QueryView query={buildings}>
        {(list) => (
          <div className="space-y-6">
            {list.length === 0 ? (
              <Panel>
                <EmptyState title="No buildings yet" action={manage ? <Button size="sm" onClick={() => setBuildingOpen(true)}>Add a building</Button> : undefined}>
                  Start with your towers or blocks, then generate their homes.
                </EmptyState>
              </Panel>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((b) => (
                  <li key={b.id}>
                    <Panel className={cn('p-5', buildingId === b.id && 'border-sage')}>
                      <button type="button" className="w-full text-left" onClick={() => (setBuildingId(buildingId === b.id ? '' : b.id), setPage(1))} aria-pressed={buildingId === b.id}>
                        <span className="flex items-center justify-between">
                          <span className="font-serif text-xl">{b.name}</span>
                          <Badge>{b.code}</Badge>
                        </span>
                        <span className="tabular mt-1 block text-sm text-muted">
                          {b.floors} floors, {b.unitCount} homes {buildingId === b.id ? '— showing below' : ''}
                        </span>
                      </button>
                      {manage && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setBulkFor(b)}>
                            Generate homes
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => (setEditingBuilding(b), setBuildingOpen(true))}>
                            Edit
                          </Button>
                          {b.unitCount === 0 && (
                            <Button size="sm" variant="ghost" onClick={() => setDeleting({ kind: 'building', id: b.id, label: b.name })}>
                              Delete
                            </Button>
                          )}
                        </div>
                      )}
                    </Panel>
                  </li>
                ))}
              </ul>
            )}
            {list.length > 0 && (
              <Panel>
                <PanelHeader title="Homes" action={manage && <Button size="sm" variant="secondary" onClick={() => (setEditingUnit(null), setUnitOpen(true))}><Plus className="size-4" />Add home</Button>} />
                <div className="flex flex-wrap gap-3 px-6 pt-4">
                  <Input aria-label="Search home" placeholder="Search, e.g. W-30" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
                  <Select aria-label="Occupancy" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="w-auto">
                    <option value="">Occupied and vacant</option>
                    <option value="occupied">Occupied</option>
                    <option value="vacant">Vacant</option>
                  </Select>
                </div>
                <QueryView query={units}>
                  {(data) => (
                    <>
                      <Table className="mt-4">
                        <thead>
                          <tr>
                            <Th>Home</Th>
                            <Th>Floor</Th>
                            <Th>Type</Th>
                            <Th>Residents</Th>
                            <Th>Status</Th>
                            {manage && (
                              <Th>
                                <span className="sr-only">Actions</span>
                              </Th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((u) => (
                            <tr key={u.id}>
                              <Td className="tabular font-medium">{u.label}</Td>
                              <Td className="tabular">{u.floor}</Td>
                              <Td>{u.type ?? '—'}</Td>
                              <Td className="tabular">{u.residentCount}</Td>
                              <Td>{u.status === 'occupied' ? <Badge tone="sage">Occupied</Badge> : <Badge>Vacant</Badge>}</Td>
                              {manage && (
                                <Td className="text-right whitespace-nowrap">
                                  <Button size="sm" variant="ghost" onClick={() => (setEditingUnit(u), setUnitOpen(true))}>
                                    Edit
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setDeleting({ kind: 'unit', id: u.id, label: u.label })}>
                                    Delete
                                  </Button>
                                </Td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                      {data.items.length === 0 && <p className="p-6 text-muted">No homes match.</p>}
                      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
                    </>
                  )}
                </QueryView>
              </Panel>
            )}
            <BuildingDialog building={editingBuilding} open={buildingOpen} onOpenChange={setBuildingOpen} />
            <UnitDialog buildings={list} unit={editingUnit} open={unitOpen} onOpenChange={setUnitOpen} />
            <BulkDialog building={bulkFor} onClose={() => setBulkFor(null)} />
          </div>
        )}
      </QueryView>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.label ?? ''}?`}
        description="Only possible when nothing refers to it. Homes with residents, vehicles, visits, complaints or bookings are kept."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </RequirePermission>
  );
}
