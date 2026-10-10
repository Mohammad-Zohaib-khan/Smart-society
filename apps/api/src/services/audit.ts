import type { Types } from 'mongoose';
import { AuditLog } from '../models/index.js';

type Meta = Record<string, string | number | boolean | null>;

export interface AuditActor {
  userId: Types.ObjectId | null;
  societyId: Types.ObjectId | null;
  ip?: string | null;
}

/** Records a high-impact action. Metadata must never contain secrets or full contact details. */
export async function audit(
  actor: AuditActor,
  action: string,
  target: { type: string; id?: Types.ObjectId | null },
  summary: string,
  metadata: Meta = {},
): Promise<void> {
  await AuditLog.create({
    societyId: actor.societyId,
    actorId: actor.userId,
    action,
    targetType: target.type,
    targetId: target.id ?? null,
    summary,
    metadata,
    ip: actor.ip ?? null,
  });
}
