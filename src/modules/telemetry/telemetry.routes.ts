import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { requireAdminCapability } from '../admin/access';
import { CallTelemetryModel } from './call-telemetry.model';
import { NotificationOutboxModel } from '../notifications/notification-outbox.model';
import { NotificationDeliveryReceiptModel } from '../notifications/notification-delivery-receipt.model';

export const telemetryRouter = Router();

const ingestWindows = new Map<string, { startedAt: number; count: number }>();

function withinIngestLimit(key: string, limit: number): boolean {
  const now = Date.now();
  if (ingestWindows.size > 10_000) {
    for (const [bucketKey, bucket] of ingestWindows) {
      if (now - bucket.startedAt >= 60_000) ingestWindows.delete(bucketKey);
    }
  }
  const current = ingestWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    ingestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

telemetryRouter.post('/telemetry/call', requireAuth, async (req: AuthedRequest, res) => {
  if (!withinIngestLimit(`call:${req.auth!.userId}`, 120)) {
    return res.status(429).json({ success: false, message: 'Telemetry rate limit exceeded' });
  }
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (events.length === 0) {
    return res.status(400).json({ success: false, message: 'events required' });
  }
  if (events.length > 50) {
    return res.status(400).json({ success: false, message: 'max 50 events per batch' });
  }

  const docs = events
    .filter((item: any) => typeof item?.event === 'string' && item.event.trim())
    .slice(0, 50)
    .map((item: any) => ({
      userId: new Types.ObjectId(req.auth!.userId),
      callId: typeof item.callId === 'string' ? item.callId.slice(0, 120) : '',
      event: String(item.event).slice(0, 120),
      payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
      platform: typeof item.platform === 'string' ? item.platform.slice(0, 32) : '',
      appVersion: typeof item.appVersion === 'string' ? item.appVersion.slice(0, 40) : '',
      clientTs: item.clientTs ? new Date(item.clientTs) : undefined,
    }));

  if (docs.length) {
    await CallTelemetryModel.insertMany(docs, { ordered: false }).catch(() => undefined);
  }
  return res.status(201).json({ success: true, data: { accepted: docs.length } });
});

telemetryRouter.post('/notifications/receipt', requireAuth, async (req: AuthedRequest, res) => {
  if (!withinIngestLimit(`receipt:${req.auth!.userId}`, 240)) {
    return res.status(429).json({ success: false, message: 'Receipt rate limit exceeded' });
  }
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  const callId = typeof req.body?.callId === 'string' ? req.body.callId.trim() : '';
  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId.trim() : '';
  const eventId = typeof req.body?.eventId === 'string' ? req.body.eventId.trim() : '';
  const allowed = new Set([
    'received',
    'displayed',
    'opened',
    'answered',
    'declined',
    'dismissed',
    'cancelled',
  ]);
  if (!deviceId || !allowed.has(status)) {
    return res.status(400).json({ success: false, message: 'deviceId and valid status required' });
  }
  if (!callId && !messageId && !eventId) {
    return res.status(400).json({ success: false, message: 'callId, messageId, or eventId required' });
  }

  const receipt = {
    userId: new Types.ObjectId(req.auth!.userId),
    deviceId: deviceId.slice(0, 200),
    status,
    callId: callId.slice(0, 120),
    messageId: messageId.slice(0, 120),
    eventId: eventId.slice(0, 200),
  };
  await NotificationDeliveryReceiptModel.updateOne(receipt, { $setOnInsert: receipt }, { upsert: true });

  return res.status(201).json({ success: true });
});

telemetryRouter.get('/admin/metrics/calls', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'analytics');
  if (!actor) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [presented, answered, restartExhausted, fgsFallback, total] = await Promise.all([
    CallTelemetryModel.countDocuments({ createdAt: { $gte: since }, event: 'incoming.presented' }),
    CallTelemetryModel.countDocuments({ createdAt: { $gte: since }, event: /answer/i }),
    CallTelemetryModel.countDocuments({ createdAt: { $gte: since }, event: 'ice.restart.exhausted' }),
    CallTelemetryModel.countDocuments({ createdAt: { $gte: since }, event: /fgs\.fallback/i }),
    CallTelemetryModel.countDocuments({ createdAt: { $gte: since } }),
  ]);

  return res.json({
    success: true,
    data: {
      windowHours: 24,
      totalEvents: total,
      incomingPresented: presented,
      answerEvents: answered,
      iceRestartExhausted: restartExhausted,
      fgsFallback,
      presentToAnswerRate: presented > 0 ? Number((answered / presented).toFixed(3)) : null,
    },
  });
});

telemetryRouter.get('/admin/metrics/notifications', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'analytics');
  if (!actor) return;

  const [pending, failed, dead, delivered, receipts24h] = await Promise.all([
    NotificationOutboxModel.countDocuments({ status: 'pending' }),
    NotificationOutboxModel.countDocuments({ status: 'failed' }),
    NotificationOutboxModel.countDocuments({ status: 'dead' }),
    NotificationOutboxModel.countDocuments({ status: 'delivered' }),
    NotificationDeliveryReceiptModel.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  if (dead > 0) {
    console.warn('[outbox.dead]', { dead, pending, failed });
  }

  return res.json({
    success: true,
    data: { pending, failed, dead, delivered, receipts24h },
  });
});

telemetryRouter.get('/admin/notifications/dead', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'analytics');
  if (!actor) return;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const rows = await NotificationOutboxModel.find({ status: 'dead' })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
  return res.json({
    success: true,
    data: rows.map((row) => ({
      id: String(row._id),
      kind: row.kind,
      userId: String(row.userId),
      eventId: row.eventId,
      correlationId: row.correlationId,
      attempts: row.attempts,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    })),
  });
});

telemetryRouter.post('/admin/notifications/:id/redrive', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'analytics');
  if (!actor) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  const updated = await NotificationOutboxModel.findOneAndUpdate(
    { _id: id, status: 'dead' },
    {
      $set: {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: '',
      },
    },
    { new: true }
  ).lean();
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Dead letter not found' });
  }
  return res.json({ success: true, data: { id: String(updated._id), status: updated.status } });
});
