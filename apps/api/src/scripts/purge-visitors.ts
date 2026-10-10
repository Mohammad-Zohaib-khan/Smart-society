/** Applies the visitor data-retention policy once (the API also runs it every 6 hours). */
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDatabase } from '../db.js';
import { createLogger } from '../lib/logger.js';
import { setRuntime } from '../services/runtime.js';
import { createEmailProvider } from '../services/email.js';
import { LocalDiskStorage } from '../services/storage.js';
import { purgeExpiredVisitorData } from '../modules/visitors.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
setRuntime({ env, logger, email: createEmailProvider(env, logger), storage: new LocalDiskStorage(env.UPLOAD_DIR), now: () => new Date() });
await connectDatabase(env.MONGODB_URI);
const n = await purgeExpiredVisitorData();
console.log(`Anonymised ${n} visitor record(s).`);
await mongoose.disconnect();
