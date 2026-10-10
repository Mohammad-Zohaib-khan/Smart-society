/**
 * Creates (or promotes) a platform administrator — the account that onboards societies.
 *   PLATFORM_ADMIN_PASSWORD='a-long-password-1' npm run create-platform-admin -- you@example.com "Your Name"
 * The password is read from the environment so it never appears in shell history arguments.
 */
import mongoose from 'mongoose';
import { email as emailSchema, password as passwordSchema } from '@smart-society/shared';
import { loadEnv } from '../config/env.js';
import { connectDatabase } from '../db.js';
import { hashPassword } from '../lib/crypto.js';
import { User } from '../models/index.js';

const [rawEmail, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
const email = emailSchema.safeParse(rawEmail);
if (!email.success || name.length < 2) {
  console.error('Usage: PLATFORM_ADMIN_PASSWORD=... npm run create-platform-admin -- <email> "<name>"');
  process.exit(1);
}
const env = loadEnv();
await connectDatabase(env.MONGODB_URI);
const existing = await User.findOne({ email: email.data });
if (existing) {
  existing.isPlatformAdmin = true;
  await existing.save();
  console.log(`Promoted existing account ${email.data} to platform admin (password unchanged).`);
} else {
  const pw = passwordSchema.safeParse(process.env.PLATFORM_ADMIN_PASSWORD ?? '');
  if (!pw.success) {
    console.error('Set PLATFORM_ADMIN_PASSWORD (10+ characters with a letter and a number).');
    await mongoose.disconnect();
    process.exit(1);
  }
  await User.create({ email: email.data, name, passwordHash: await hashPassword(pw.data), isPlatformAdmin: true });
  console.log(`Created platform admin ${email.data}. Sign in and open Platform to onboard a society.`);
}
await mongoose.disconnect();
