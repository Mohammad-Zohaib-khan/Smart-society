import { beforeAll, describe, expect, it } from 'vitest';
import { seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { ParkingAssignment } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
beforeAll(async () => {
  s = await seedSociety('park');
});

describe('vehicles and parking', () => {
  it('resident registers vehicles with normalised plates; duplicates are refused society-wide', async () => {
    const r1 = await signedIn(t.app, s.emails.resident);
    const r2 = await signedIn(t.app, s.emails.resident2);
    expect((await r1.post('/api/parking/vehicles', { registrationNumber: 'mh 12 ab 1234', type: 'car', make: 'Tata', model: 'Nexon' })).status).toBe(201);
    expect((await r1.post('/api/parking/vehicles', { registrationNumber: 'MH12CD5678', type: 'two_wheeler' })).status).toBe(201);
    const dup = await r2.post('/api/parking/vehicles', { registrationNumber: 'MH-12-AB-1234', type: 'car' });
    expect(dup.status).toBe(409);
    expect((await r2.post('/api/parking/vehicles', { registrationNumber: 'KA01EF9999', type: 'ev_car' })).status).toBe(201);
    const list = await r1.get('/api/parking/vehicles');
    expect(list.body.items.map((v: { registrationNumber: string }) => v.registrationNumber)).toEqual(['MH12AB1234', 'MH12CD5678']);
  });

  it('assigns slots by type and never double-assigns a slot or a vehicle, even concurrently', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const admin2 = await signedIn(t.app, s.emails.admin);
    const p1 = await admin.post('/api/parking/slots', { code: 'P-01', type: 'car', level: 'B1', active: true });
    const p2 = await admin.post('/api/parking/slots', { code: 'P-02', type: 'car', level: 'B1', active: true });
    const ev = await admin.post('/api/parking/slots', { code: 'EV-1', type: 'ev', active: true });
    const vehicles = (await admin.get('/api/parking/vehicles')).body.items as Array<{ id: string; registrationNumber: string }>;
    const car = vehicles.find((v) => v.registrationNumber === 'MH12AB1234')!;
    const bike = vehicles.find((v) => v.registrationNumber === 'MH12CD5678')!;
    const evCar = vehicles.find((v) => v.registrationNumber === 'KA01EF9999')!;

    expect((await admin.post(`/api/parking/slots/${p1.body.id}/assign`, { vehicleId: bike.id })).status).toBe(400);
    expect((await admin.post(`/api/parking/slots/${ev.body.id}/assign`, { vehicleId: car.id })).status).toBe(400);

    const race = await Promise.all([
      admin.post(`/api/parking/slots/${p1.body.id}/assign`, { vehicleId: car.id }),
      admin2.post(`/api/parking/slots/${p1.body.id}/assign`, { vehicleId: evCar.id }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ParkingAssignment.countDocuments({ slotId: p1.body.id, active: true })).toBe(1);

    const winner = race.find((r) => r.status === 201) === race[0] ? car : evCar;
    const second = await admin.post(`/api/parking/slots/${p2.body.id}/assign`, { vehicleId: winner.id });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('vehicle_has_slot');
  });

  it('reflects the same persisted state for residents, managers and the gate', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const slots = (await admin.get('/api/parking/slots')).body as Array<{ code: string; assignment: { registrationNumber: string } | null }>;
    const p1 = slots.find((x) => x.code === 'P-01')!;
    const reg = p1.assignment!.registrationNumber;
    const owner = reg === 'MH12AB1234' ? s.emails.resident : s.emails.resident2;
    const resident = await signedIn(t.app, owner);
    const mine = (await resident.get('/api/parking/vehicles')).body.items.find((v: { registrationNumber: string }) => v.registrationNumber === reg);
    expect(mine.slotCode).toBe('P-01');
    const guard = await signedIn(t.app, s.emails.guard);
    const lookup = await guard.get(`/api/parking/lookup/${reg}`);
    expect(lookup.body).toMatchObject({ registrationNumber: reg, slotCode: 'P-01' });
    expect(Object.keys(lookup.body).sort()).toEqual(['registrationNumber', 'slotCode', 'type', 'unitLabel']);
    expect((await guard.get('/api/parking/slots')).status).toBe(403);
  });

  it('protects assigned vehicles and slots, then releases cleanly', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const slot = ((await admin.get('/api/parking/slots')).body as Array<{ id: string; code: string; assignment: { vehicleId: string } | null }>).find((x) => x.code === 'P-01')!;
    expect((await admin.delete(`/api/parking/vehicles/${slot.assignment!.vehicleId}`)).status).toBe(409);
    expect((await admin.patch(`/api/parking/slots/${slot.id}`, { code: 'P-01', type: 'car', active: false })).status).toBe(409);
    expect((await admin.post(`/api/parking/slots/${slot.id}/release`)).status).toBe(204);
    expect((await admin.post(`/api/parking/slots/${slot.id}/release`)).status).toBe(409);
    expect((await admin.delete(`/api/parking/slots/${slot.id}`)).status).toBe(409); // history kept
    const history = await admin.get('/api/parking/assignments');
    expect(history.body.items[0].endedAt).not.toBeNull();
  });

  it('keeps residents to their own vehicles', async () => {
    const r1 = await signedIn(t.app, s.emails.resident);
    const r2 = await signedIn(t.app, s.emails.resident2);
    const theirs = (await r2.get('/api/parking/vehicles')).body.items[0];
    expect((await r1.patch(`/api/parking/vehicles/${theirs.id}`, { registrationNumber: 'XX00XX0000', type: 'car' })).status).toBe(404);
    expect((await r1.delete(`/api/parking/vehicles/${theirs.id}`)).status).toBe(404);
  });
});
