import type { Types } from 'mongoose';
import type { ChannelStatus, NotificationType, SocietyRole } from '@smart-society/shared';
import { Membership, Notification, User } from '../models/index.js';
import { runtime } from './runtime.js';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
}

/**
 * Delivers an in-app notification to each user (respecting muted types) and, where the user
 * opted in and an email provider is configured, an email copy. Email failures are logged and
 * never fail the business operation that triggered them.
 */
export async function notify(
  societyId: Types.ObjectId | null,
  userIds: Array<Types.ObjectId | string>,
  payload: NotificationPayload,
  options: { exclude?: Types.ObjectId | string | null } = {},
): Promise<number> {
  const exclude = options.exclude ? String(options.exclude) : null;
  const unique = [...new Set(userIds.map(String))].filter((id) => id !== exclude);
  if (!unique.length) return 0;
  const users = await User.find(
    { _id: { $in: unique }, status: 'active', 'notificationPrefs.mutedTypes': { $ne: payload.type } },
    { email: 1, notificationPrefs: 1 },
  ).lean();
  if (!users.length) return 0;
  await Notification.insertMany(
    users.map((u) => ({
      societyId,
      userId: u._id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link ?? null,
    })),
  );
  const { email, logger, env } = runtime();
  if (email.kind !== 'none') {
    const recipients = users.filter((u) => u.notificationPrefs?.emailEnabled);
    for (const u of recipients) {
      const link = payload.link ? `\n\nOpen: ${env.APP_URL}${payload.link}` : '';
      email
        .send({ to: u.email, subject: payload.title, text: `${payload.body}${link}` })
        .catch((err: unknown) => logger.warn({ err, type: payload.type }, 'Notification email failed'));
    }
  }
  return users.length;
}

export async function activeResidentsOfUnit(societyId: Types.ObjectId, unitId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await Membership.find({ societyId, unitId, role: 'resident', status: 'active' }, { userId: 1 }).lean();
  return rows.map((r) => r.userId);
}

export async function activeMembersWithRoles(societyId: Types.ObjectId, roles: SocietyRole[]): Promise<Types.ObjectId[]> {
  const rows = await Membership.find({ societyId, role: { $in: roles }, status: 'active' }, { userId: 1 }).lean();
  return rows.map((r) => r.userId);
}

export function channelStatuses(): ChannelStatus[] {
  const { email } = runtime();
  const emailStatus: ChannelStatus =
    email.kind === 'smtp'
      ? { channel: 'email', state: 'active', detail: 'SMTP provider configured. Delivery depends on your mail server.' }
      : email.kind === 'console'
        ? { channel: 'email', state: 'console_dev', detail: 'Development mode: emails are written to the API log, not sent.' }
        : { channel: 'email', state: 'not_configured', detail: 'Set EMAIL_PROVIDER=smtp and SMTP_* variables to enable email.' };
  return [
    { channel: 'in_app', state: 'active', detail: 'Delivered to the notification centre.' },
    emailStatus,
    { channel: 'sms', state: 'not_configured', detail: 'No SMS provider adapter is included in this build.' },
    { channel: 'whatsapp', state: 'not_configured', detail: 'No WhatsApp Business adapter is included in this build.' },
    { channel: 'push', state: 'not_configured', detail: 'Web push is not implemented in this build.' },
  ];
}
