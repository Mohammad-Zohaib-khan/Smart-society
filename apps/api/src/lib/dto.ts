import type { Types } from 'mongoose';
import type { UserSummary } from '@smart-society/shared';
import { User } from '../models/index.js';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const idStr = (id: Types.ObjectId | string | null | undefined): string | null => (id ? String(id) : null);

/** Batch-load display names for a set of user ids (one query per response). */
export async function userNames(ids: Array<Types.ObjectId | null | undefined>): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(ids.filter((v): v is Types.ObjectId => Boolean(v)).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name }]));
}

export function summary(map: Map<string, UserSummary>, id: Types.ObjectId | null | undefined): UserSummary | null {
  if (!id) return null;
  return map.get(String(id)) ?? { id: String(id), name: 'Former member' };
}

/** Show only the last 4 digits of a phone number. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '••••' : `••••••${digits.slice(-4)}`;
}
