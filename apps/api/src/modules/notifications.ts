import { Router } from 'express';
import type { NotificationDto, NotificationType, Paginated } from '@smart-society/shared';
import { Notification } from '../models/index.js';
import { requireAuth } from '../lib/context.js';
import { notFound } from '../lib/errors.js';
import { idParam } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { channelStatuses } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';

/** Notifications belong to a user; within a session they are scoped to the active society. */
export function notificationsRouter(): Router {
  const r = Router();
  const scope = (req: Parameters<typeof requireAuth>[0]) => {
    const ctx = requireAuth(req);
    return { userId: ctx.userId, societyId: ctx.society?._id ?? null };
  };

  r.get('/', async (req, res) => {
    const filter: Record<string, unknown> = scope(req);
    const { page, pageSize } = pageParams(req.query);
    if (req.query.unread === '1') filter.readAt = null;
    const [rows, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Notification.countDocuments(filter),
    ]);
    const items: NotificationDto[] = rows.map((n) => ({
      id: String(n._id),
      type: n.type as NotificationType,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));
    res.json({ items, page, pageSize, total } satisfies Paginated<NotificationDto>);
  });

  r.get('/unread-count', async (req, res) => {
    res.json({ count: await Notification.countDocuments({ ...scope(req), readAt: null }) });
  });

  r.get('/channels', (req, res) => {
    requireAuth(req);
    res.json(channelStatuses());
  });

  r.post('/read-all', async (req, res) => {
    const result = await Notification.updateMany({ ...scope(req), readAt: null }, { $set: { readAt: runtime().now() } });
    res.json({ updated: result.modifiedCount });
  });

  r.post('/:id/read', async (req, res) => {
    const id = idParam(req.params.id, 'Notification');
    const n = await Notification.findOneAndUpdate({ _id: id, ...scope(req) }, { $set: { readAt: runtime().now() } });
    if (!n) throw notFound('Notification');
    res.status(204).end();
  });

  return r;
}
