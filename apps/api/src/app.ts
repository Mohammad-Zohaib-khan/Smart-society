import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { setRuntime, type Runtime } from './services/runtime.js';
import { createEmailProvider, type EmailProvider } from './services/email.js';
import { LocalDiskStorage, type FileStorage } from './services/storage.js';
import { loadSession } from './middleware/session.js';
import { csrfProtection } from './middleware/csrf.js';
import { createLimiters } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { platformRouter } from './modules/platform.js';
import { societyRouter } from './modules/society.js';
import { visitorsRouter } from './modules/visitors.js';
import { parkingRouter } from './modules/parking.js';
import { complaintsRouter } from './modules/complaints.js';
import { announcementsRouter } from './modules/announcements.js';
import { amenitiesRouter } from './modules/amenities.js';
import { notificationsRouter } from './modules/notifications.js';
import { insightsRouter } from './modules/insights.js';

export interface AppOptions {
  env: Env;
  logger: Logger;
  email?: EmailProvider;
  storage?: FileStorage;
  now?: () => Date;
}

export function createApp(options: AppOptions) {
  const runtime: Runtime = {
    env: options.env,
    logger: options.logger,
    email: options.email ?? createEmailProvider(options.env, options.logger),
    storage: options.storage ?? new LocalDiskStorage(options.env.UPLOAD_DIR),
    now: options.now ?? (() => new Date()),
  };
  setRuntime(runtime);
  const { env, logger } = runtime;
  const limiters = createLimiters();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  // Express 5 defaults to the "simple" query parser: no nested objects, so no `?a[$ne]=` operators.
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: env.NODE_ENV !== 'test',
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        // Status only: response headers would include Set-Cookie and are not useful in logs.
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // CORS: only the configured web origins, with credentials. Implemented inline to keep it explicit.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && env.WEB_ORIGIN.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
    } else if (origin && req.method === 'OPTIONS') {
      res.status(403).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: runtime.now().toISOString() });
  });

  const api = Router();
  api.use(limiters.general);
  api.use(loadSession);
  api.use(csrfProtection);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', authRouter(limiters));
  api.use('/platform', platformRouter());
  api.use('/society', societyRouter());
  api.use('/visitors', visitorsRouter(limiters));
  api.use('/parking', parkingRouter(limiters));
  api.use('/complaints', complaintsRouter(limiters));
  api.use('/announcements', announcementsRouter());
  api.use('/amenities', amenitiesRouter());
  api.use('/notifications', notificationsRouter());
  api.use('/', insightsRouter());
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
