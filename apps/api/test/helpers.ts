import { afterAll, beforeAll, inject } from 'vitest';
import mongoose, { type Types } from 'mongoose';
import supertest from 'supertest';
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { ALL_MODELS, Building, Membership, Society, Unit, User } from '../src/models/index.js';
import { hashPassword } from '../src/lib/crypto.js';
import type { EmailMessage, EmailProvider } from '../src/services/email.js';
import type { SocietyRole } from '@smart-society/shared';

export const PASSWORD = 'correct-horse-42';

export class CapturingEmail implements EmailProvider {
  readonly kind = 'smtp' as const;
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return true;
  }
}

export interface TestContext {
  app: Express;
  clock: { now: Date; set(iso: string): void; advance(ms: number): void };
  email: CapturingEmail;
}

/** Connects to a fresh database for the calling test file and builds an app around it. */
export function useTestApp(options: { rateLimits?: boolean } = {}): TestContext {
  const ctx = {} as TestContext;
  const clock = {
    now: new Date('2026-10-12T04:30:00.000Z'), // 10:00 in Asia/Kolkata on a Monday
    set(iso: string) {
      this.now = new Date(iso);
    },
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  ctx.clock = clock;
  ctx.email = new CapturingEmail();

  beforeAll(async () => {
    const dbName = `ss_test_${randomBytes(6).toString('hex')}`;
    await mongoose.connect(inject('mongoUri'), { dbName, autoIndex: false });
    await Promise.all(ALL_MODELS.map((m) => (m as unknown as { createIndexes: () => Promise<unknown> }).createIndexes()));
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'unused',
      WEB_ORIGIN: 'http://localhost:5173',
      UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'ss-uploads-')),
      LOG_LEVEL: 'silent',
      RATE_LIMIT_DISABLED: options.rateLimits ? 'false' : 'true',
      COOKIE_SECURE: 'false',
    });
    ctx.app = createApp({ env, logger: createLogger('silent'), email: ctx.email, now: () => clock.now });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  return ctx;
}

/** A cookie-keeping client that performs the CSRF double-submit like the web app does. */
export class Client {
  readonly agent;
  csrf = '';
  constructor(app: Express) {
    this.agent = supertest.agent(app);
  }
  async init() {
    const res = await this.agent.get('/api/auth/csrf');
    this.csrf = res.body.csrfToken;
    return this;
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.agent.put(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent.patch(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  delete(url: string) {
    return this.agent.delete(url).set('X-CSRF-Token', this.csrf);
  }
  async login(email: string, password = PASSWORD) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    const csrf = await this.agent.get('/api/auth/csrf');
    this.csrf = csrf.body.csrfToken;
    return res.body;
  }
}

export async function signedIn(app: Express, email: string): Promise<Client> {
  const c = await new Client(app).init();
  await c.login(email);
  return c;
}

let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(PASSWORD));

export interface SeededSociety {
  societyId: Types.ObjectId;
  buildingId: Types.ObjectId;
  units: Types.ObjectId[];
  emails: Record<'admin' | 'committee' | 'guard' | 'resident' | 'resident2' | 'staff' | 'staff2', string>;
  membershipIds: Record<string, Types.ObjectId>;
  userIds: Record<string, Types.ObjectId>;
}

/** Creates a society with one member per role. Residents live in units[0] and units[1]. */
export async function seedSociety(tag: string, overrides: { walkInRequiresResidentApproval?: boolean } = {}): Promise<SeededSociety> {
  const society = await Society.create({
    name: `Test Society ${tag}`,
    city: 'Pune',
    address: '1 Test Road, Pune',
    timezone: 'Asia/Kolkata',
    settings: { visitorPolicy: { walkInRequiresResidentApproval: overrides.walkInRequiresResidentApproval ?? true } },
  });
  const building = await Building.create({ societyId: society._id, name: 'Tower A', code: 'A', floors: 10 });
  const units = await Unit.insertMany(
    ['101', '102', '201'].map((n) => ({ societyId: society._id, buildingId: building._id, number: n, label: `A-${n}`, floor: Number(n[0]), status: 'occupied' })),
  );
  const hash = await passwordHash();
  const roles: Array<[keyof SeededSociety['emails'], SocietyRole, Types.ObjectId | null]> = [
    ['admin', 'admin', null],
    ['committee', 'committee', null],
    ['guard', 'guard', null],
    ['resident', 'resident', units[0]!._id],
    ['resident2', 'resident', units[1]!._id],
    ['staff', 'staff', null],
    ['staff2', 'staff', null],
  ];
  const emails = {} as SeededSociety['emails'];
  const membershipIds: Record<string, Types.ObjectId> = {};
  const userIds: Record<string, Types.ObjectId> = {};
  for (const [key, role, unitId] of roles) {
    const email = `${key}.${tag}@example.test`.toLowerCase();
    const user = await User.create({ email, name: `${key} ${tag}`, passwordHash: hash });
    const m = await Membership.create({ userId: user._id, societyId: society._id, role, unitId });
    emails[key] = email;
    membershipIds[key] = m._id;
    userIds[key] = user._id;
  }
  return { societyId: society._id, buildingId: building._id, units: units.map((u) => u._id), emails, membershipIds, userIds };
}

/** ISO string with +05:30 offset for a local Kolkata wall-clock time. */
export const ist = (local: string) => `${local}:00+05:30`;
