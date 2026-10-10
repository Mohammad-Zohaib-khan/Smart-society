import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Car, CheckCircle2, CircleX, LogOut, Search, UserPlus } from 'lucide-react';
import {
  VISIT_PURPOSES,
  walkInSchema,
  type GateBoard,
  type GateUnitDto,
  type GateVehicleLookup,
  type PassVerification,
  type VisitDto,
  type WalkInInput,
} from '@smart-society/shared';
import { api, ApiError, errorMessage, qs } from '@/lib/api';
import { fmt, humanise } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, ListSkeleton } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { PURPOSE_LABELS } from '@/features/common/badges';
import { RequirePermission } from '@/features/common/Guard';

const REASONS: Record<string, string> = {
  not_yet_valid: 'Too early — this pass is not valid yet',
  expired: 'This pass has expired',
  cancelled: 'The resident cancelled this pass',
  already_used: 'This pass was already used',
};

function useBoardRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['gate-board'] });
}

function PassChecker() {
  const [code, setCode] = useState('');
  const refresh = useBoardRefresh();
  const verify = useMutation({ mutationFn: (c: string) => api.post<PassVerification>('/visitors/gate/verify', { code: c }) });
  const checkIn = useMutation({
    mutationFn: (id: string) => api.post<VisitDto>(`/visitors/gate/invitations/${id}/check-in`),
    onSuccess: (v) => {
      toast.success(`${v.visitorName} checked in for ${v.unitLabel}`);
      verify.reset();
      setCode('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const result = verify.data;
  const notFound = verify.error instanceof ApiError && verify.error.status === 404;
  return (
    <Panel className="p-6">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) verify.mutate(code);
        }}
      >
        <div className="flex-1">
          <label htmlFor="pass-code" className="mb-1.5 block text-base font-medium">
            Pass code
          </label>
          <input
            id="pass-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
              verify.reset();
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            placeholder="6 characters"
            className="tabular h-16 w-full rounded-2xl border-2 border-foreground/70 bg-surface px-5 text-3xl font-semibold tracking-[0.35em] text-foreground placeholder:text-base placeholder:font-normal placeholder:tracking-normal focus-visible:border-terracotta focus-visible:outline-none"
          />
        </div>
        <Button type="submit" size="lg" className="h-16 px-8 text-lg" disabled={code.length !== 6} loading={verify.isPending}>
          <Search className="size-5" strokeWidth={2} />
          Check pass
        </Button>
      </form>

      <div aria-live="polite" className="mt-4">
        {notFound && <p className="rounded-2xl border-2 border-danger bg-danger-soft px-5 py-4 text-lg font-medium text-danger">No pass with that code in this society.</p>}
        {verify.error && !notFound && <p className="rounded-2xl bg-danger-soft px-5 py-4 text-danger">{errorMessage(verify.error)}</p>}
        {result && (
          <div className={`rounded-2xl border-2 p-5 ${result.checkIn.ok ? 'border-sage-ink bg-sage-soft' : 'border-danger bg-danger-soft'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold">
                  {result.checkIn.ok ? <CheckCircle2 className="size-6 text-sage-ink" /> : <CircleX className="size-6 text-danger" />}
                  {result.checkIn.ok ? 'Valid pass' : REASONS[result.checkIn.reason]}
                </p>
                <p className="mt-2 text-2xl font-serif">{result.invitation.visitorName}</p>
                <p className="mt-1 text-base">
                  For <strong>{result.invitation.unitLabel}</strong> — {PURPOSE_LABELS[result.invitation.purpose]}, {result.invitation.guestCount} {result.invitation.guestCount === 1 ? 'person' : 'people'}
                  {result.invitation.vehicleNumber ? `, vehicle ${result.invitation.vehicleNumber}` : ''}
                </p>
                <p className="text-muted">
                  Valid {fmt.dateTime(result.invitation.validFrom)} – {fmt.dateTime(result.invitation.validUntil)}
                </p>
              </div>
              {result.checkIn.ok && (
                <Button size="lg" className="h-14 px-8 text-lg" loading={checkIn.isPending} onClick={() => checkIn.mutate(result.invitation.id)}>
                  Check in
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function VehicleLookup() {
  const [reg, setReg] = useState('');
  const lookup = useMutation({ mutationFn: (r: string) => api.get<GateVehicleLookup>(`/parking/lookup/${encodeURIComponent(r)}`) });
  return (
    <Panel className="p-6">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reg.length >= 4) lookup.mutate(reg);
        }}
      >
        <label htmlFor="veh" className="mb-0.5 block text-base font-medium">
          Resident vehicle
        </label>
        <Input id="veh" value={reg} placeholder="e.g. MH12AB1234" onChange={(e) => setReg(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className="tabular h-12 text-lg" />
        <Button type="submit" variant="secondary" className="h-12" loading={lookup.isPending} disabled={reg.length < 4}>
          <Car className="size-5" strokeWidth={1.5} />
          Look up
        </Button>
      </form>
      <div aria-live="polite">
        {lookup.data && (
          <p className="mt-3 text-base">
            <strong>{lookup.data.registrationNumber}</strong> belongs to {lookup.data.unitLabel}
            {lookup.data.slotCode ? `, parks in ${lookup.data.slotCode}` : ', no slot assigned'}.
          </p>
        )}
        {lookup.error && <p className="mt-3 text-danger">{lookup.error instanceof ApiError && lookup.error.status === 404 ? 'Not a registered resident vehicle.' : errorMessage(lookup.error)}</p>}
      </div>
    </Panel>
  );
}

function UnitPicker({ value, onChange, error }: { value: string; onChange: (id: string) => void; error?: string | undefined }) {
  const [q, setQ] = useState('');
  const units = useQuery({ queryKey: ['gate-units', q], queryFn: () => api.get<GateUnitDto[]>(`/society/gate-units${qs({ q })}`) });
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Visiting home</legend>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. W-30" aria-label="Search homes" />
      <div role="radiogroup" aria-label="Homes" className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto" data-lenis-prevent>
        {units.data?.map((u) => (
          <button
            key={u.id}
            type="button"
            role="radio"
            aria-checked={value === u.id}
            onClick={() => onChange(u.id)}
            className={`min-h-11 rounded-full border px-4 text-base ${value === u.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-surface hover:border-sage'}`}
          >
            {u.label}
            {!u.hasActiveResidents && <span className="ml-1 text-sm opacity-70">(no residents)</span>}
          </button>
        ))}
        {units.data?.length === 0 && <p className="text-sm text-muted">No homes match.</p>}
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

function WalkInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useBoardRefresh();
  const form = useForm<WalkInInput>({
    resolver: zodResolver(walkInSchema),
    defaultValues: { visitorName: '', visitorPhone: '', purpose: 'delivery', unitId: '', guestCount: 1, vehicleNumber: '' },
  });
  const m = useMutation({
    mutationFn: (v: WalkInInput) => api.post<{ visit: VisitDto; residentsNotified: number }>('/visitors/gate/walk-ins', v),
    onSuccess: (r) => {
      toast.success(r.residentsNotified ? `${r.residentsNotified} resident(s) asked to approve` : 'No resident app users for that home — confirm by intercom');
      form.reset();
      onOpenChange(false);
      void refresh();
    },
    onError: (e) => handleFormError(e, form.setError, ['visitorName', 'visitorPhone', 'unitId', 'guestCount', 'vehicleNumber']),
  });
  const unitId = form.watch('unitId');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Register a walk-in" description="The resident is asked to approve in the app. You can also record an intercom answer.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Visitor name" error={form.formState.errors.visitorName?.message}>
          <Input autoComplete="off" {...form.register('visitorName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purpose">
            <Select {...form.register('purpose')}>
              {VISIT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="People" error={form.formState.errors.guestCount?.message}>
            <Input type="number" min={1} max={20} {...form.register('guestCount', { valueAsNumber: true })} />
          </Field>
        </div>
        <UnitPicker value={unitId} onChange={(id) => form.setValue('unitId', id, { shouldValidate: true })} error={form.formState.errors.unitId ? 'Choose the home they are visiting' : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" optional error={form.formState.errors.visitorPhone?.message}>
            <Input type="tel" autoComplete="off" {...form.register('visitorPhone')} />
          </Field>
          <Field label="Vehicle number" optional error={form.formState.errors.vehicleNumber?.message}>
            <Input autoComplete="off" {...form.register('vehicleNumber')} />
          </Field>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={m.isPending}>
          Ask resident to approve
        </Button>
      </form>
    </Dialog>
  );
}

function DecisionDialog({ visit, onClose, requireResident }: { visit: VisitDto | null; onClose: () => void; requireResident: boolean }) {
  const refresh = useBoardRefresh();
  const [method, setMethod] = useState<'intercom' | 'phone_call' | 'in_person'>('intercom');
  const m = useMutation({
    mutationFn: (decision: 'approve' | 'deny') => api.post<VisitDto>(`/visitors/gate/visits/${visit?.id}/decision`, { decision, method }),
    onSuccess: (v) => {
      toast.success(v.status === 'inside' ? `${v.visitorName} let in` : `${v.visitorName} turned away`);
      onClose();
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={Boolean(visit)} onOpenChange={(o) => !o && onClose()} title="Record the resident’s answer" description={visit ? `${visit.visitorName} for ${visit.unitLabel}` : ''}>
      <Field label="How did you confirm?">
        <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="intercom">Intercom with the resident</option>
          <option value="phone_call">Phone call with the resident</option>
          <option value="in_person" disabled={requireResident}>
            Guard decision on the spot{requireResident ? ' (not allowed by society policy)' : ''}
          </option>
        </Select>
      </Field>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button variant="danger" size="lg" loading={m.isPending && m.variables === 'deny'} onClick={() => m.mutate('deny')}>
          Deny entry
        </Button>
        <Button size="lg" loading={m.isPending && m.variables === 'approve'} onClick={() => m.mutate('approve')}>
          Let in
        </Button>
      </div>
    </Dialog>
  );
}

function Board() {
  const board = useQuery({ queryKey: ['gate-board'], queryFn: () => api.get<GateBoard>('/visitors/gate/board'), refetchInterval: 10_000 });
  const settings = useQuery({ queryKey: ['society-settings'], queryFn: () => api.get<{ visitorPolicy: { walkInRequiresResidentApproval: boolean } }>('/society/settings') });
  const refresh = useBoardRefresh();
  const [deciding, setDeciding] = useState<VisitDto | null>(null);
  const checkOut = useMutation({
    mutationFn: (id: string) => api.post<VisitDto>(`/visitors/gate/visits/${id}/check-out`),
    onSuccess: (v) => {
      toast.success(`${v.visitorName} checked out`);
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const checkIn = useMutation({
    mutationFn: (id: string) => api.post<VisitDto>(`/visitors/gate/invitations/${id}/check-in`),
    onSuccess: (v) => {
      toast.success(`${v.visitorName} checked in`);
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.post(`/visitors/gate/visits/${id}/withdraw`),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (board.isPending) return <ListSkeleton rows={6} />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;
  const b = board.data;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel className={b.awaitingApproval.length ? 'border-2 border-terracotta' : ''}>
        <PanelHeader title={`Waiting for residents (${b.awaitingApproval.length})`} />
        <ul className="space-y-3 p-6">
          {b.awaitingApproval.length === 0 && <li className="text-muted">No one waiting.</li>}
          {b.awaitingApproval.map((v) => (
            <li key={v.id} className="rounded-2xl border border-border p-4">
              <p className="text-lg font-semibold">{v.visitorName}</p>
              <p className="text-base">
                {v.unitLabel} — {PURPOSE_LABELS[v.purpose]}
              </p>
              <p className="text-sm text-muted">Waiting since {fmt.time(v.createdAt)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDeciding(v)}>
                  Record answer
                </Button>
                <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === v.id} onClick={() => withdraw.mutate(v.id)}>
                  Visitor left
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title={`Inside now (${b.inside.length})`} />
        <ul className="divide-y divide-border px-6 pb-4">
          {b.inside.length === 0 && <li className="py-3 text-muted">No visitors inside.</li>}
          {b.inside.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{v.visitorName}</p>
                <p className="text-sm text-muted">
                  {v.unitLabel}, in since {fmt.time(v.checkedInAt)}
                  {v.vehicleNumber ? `, ${v.vehicleNumber}` : ''}
                </p>
              </div>
              <Button variant="secondary" size="sm" className="h-11" loading={checkOut.isPending && checkOut.variables === v.id} onClick={() => checkOut.mutate(v.id)}>
                <LogOut className="size-4" />
                Check out
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title={`Expected today (${b.expectedToday.length})`} />
        <ul className="divide-y divide-border px-6 pb-4">
          {b.expectedToday.length === 0 && <li className="py-3 text-muted">No pre-approved visitors left today.</li>}
          {b.expectedToday.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{i.visitorName}</p>
                <p className="text-sm text-muted">
                  {i.unitLabel}, {fmt.time(i.validFrom)}–{fmt.time(i.validUntil)} <Badge className="ml-1">{i.code}</Badge>
                </p>
              </div>
              <Button size="sm" className="h-11" loading={checkIn.isPending && checkIn.variables === i.id} onClick={() => checkIn.mutate(i.id)}>
                Check in
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      <DecisionDialog visit={deciding} onClose={() => setDeciding(null)} requireResident={settings.data?.visitorPolicy.walkInRequiresResidentApproval ?? true} />
    </div>
  );
}

export function GatePage() {
  const { data } = useSession();
  const [walkIn, setWalkIn] = useState(false);
  return (
    <RequirePermission any={['gate.operate']}>
      {/* The gate desk is deliberately plain: large type, high contrast, no decorative motion. */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl">Gate desk</h1>
            <p className="mt-1 text-muted">
              {data?.membership?.societyName}, {humanise(fmt.weekdayDate(new Date().toISOString()))}
            </p>
          </div>
          <Button size="lg" className="h-14 px-7 text-lg" onClick={() => setWalkIn(true)}>
            <UserPlus className="size-5" />
            Register walk-in
          </Button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <PassChecker />
          <VehicleLookup />
        </div>
        <Board />
      </div>
      <WalkInDialog open={walkIn} onOpenChange={setWalkIn} />
    </RequirePermission>
  );
}
