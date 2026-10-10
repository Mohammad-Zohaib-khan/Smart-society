import type { z } from 'zod';
import { Types } from 'mongoose';
import { badRequest, notFound } from './errors.js';

/** Parses input with a schema; maps issues to a field → message record for forms. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    fields[key] ??= issue.message;
  }
  throw badRequest('Please check the highlighted fields', fields);
}

/** Path ids: invalid ids are reported as not found so probing reveals nothing. */
export function idParam(value: unknown, what = 'Record'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || !/^[a-f\d]{24}$/i.test(value)) throw notFound(what);
  return new Types.ObjectId(value);
}

export function oid(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Optional single-valued search query: rejects arrays and trims. */
export function queryString(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v.slice(0, max) : undefined;
}

export function queryEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
