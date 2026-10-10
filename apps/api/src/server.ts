import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { purgeExpiredVisitorData } from './modules/visitors.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);

async function main(): Promise<void> {
  await connectDatabase(env.MONGODB_URI);
  logger.info('Connected to MongoDB');
  const app = createApp({ env, logger });
  const server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));

  // Visitor data retention: anonymise expired visitor records every 6 hours.
  const runPurge = () =>
    purgeExpiredVisitorData()
      .then((n) => n && logger.info({ anonymised: n }, 'Visitor retention purge'))
      .catch((err: unknown) => logger.error({ err }, 'Visitor retention purge failed'));
  void runPurge();
  const timer = setInterval(runPurge, 6 * 3_600_000);
  timer.unref();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(timer);
    server.close(() => {
      void disconnectDatabase().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
