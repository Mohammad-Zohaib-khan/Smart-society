/**
 * Process-wide services configured once at startup (or per test app). Kept deliberately small:
 * configuration, logger, email provider and upload storage.
 */
import type { Env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import type { EmailProvider } from './email.js';
import type { FileStorage } from './storage.js';

export interface Runtime {
  env: Env;
  logger: Logger;
  email: EmailProvider;
  storage: FileStorage;
  /** Injectable clock so time-based rules are testable. */
  now: () => Date;
}

let current: Runtime | undefined;

export function setRuntime(runtime: Runtime): void {
  current = runtime;
}

export function runtime(): Runtime {
  if (!current) throw new Error('Runtime not configured');
  return current;
}
