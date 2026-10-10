import mongoose from 'mongoose';
import { ALL_MODELS } from './models/index.js';

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  // Build declared indexes explicitly so uniqueness rules exist before traffic arrives.
  await Promise.all(ALL_MODELS.map((m) => (m as unknown as { createIndexes: () => Promise<unknown> }).createIndexes()));
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
