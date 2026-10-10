import { beforeAll, describe, expect, it } from 'vitest';
import { Client, seedSociety, useTestApp, type SeededSociety } from './helpers.js';

const t = useTestApp({ rateLimits: true });
let s: SeededSociety;
beforeAll(async () => {
  s = await seedSociety('rl');
});

describe('rate limiting', () => {
  it('throttles repeated sign-in attempts', async () => {
    const c = await new Client(t.app).init();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await c.post('/api/auth/login', { email: s.emails.guard, password: 'nope-nope-1' })).status);
    expect(statuses.slice(0, 5).every((st) => st === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
