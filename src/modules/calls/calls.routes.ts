import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { clearPendingCall, getPendingCall } from './pending-call.service';
import { emitToUser } from '../../sockets/io';
import { getCloudflareIceServers } from './ice-servers.service';
import { enqueueNotification } from '../notifications/notification-outbox.service';

export const callsRouter = Router();

callsRouter.get('/ice-servers', requireAuth, async (_req: AuthedRequest, res) => {
  const data = await getCloudflareIceServers(3_600);
  return res.json({ success: true, data });
});

callsRouter.get('/incoming', requireAuth, async (req: AuthedRequest, res) => {
  const pending = await getPendingCall(req.auth!.userId);
  if (!pending) {
    return res.json({ success: true, data: null });
  }
  return res.json({
    success: true,
    data: {
      callId: pending.callId,
      callerId: pending.callerId,
      callerName: pending.callerName,
      isVideo: pending.isVideo,
      offer: pending.offer,
      createdAt: pending.createdAt,
    },
  });
});

callsRouter.post('/incoming/decline', requireAuth, async (req: AuthedRequest, res) => {
  const pending = await getPendingCall(req.auth!.userId);
  await clearPendingCall(req.auth!.userId);
  if (pending?.callerId) {
    emitToUser(pending.callerId, 'call:ended', {
      reason: 'declined',
      callId: pending.callId,
    });
  }
  if (pending?.callId) {
    void enqueueNotification({
      eventId: `call_cancel:${pending.callId}:${req.auth!.userId}`,
      userId: req.auth!.userId,
      kind: 'call_cancel',
      correlationId: pending.callId,
      payload: { callId: pending.callId }
    });
    if (pending.callerId) {
      void enqueueNotification({
        eventId: `call_cancel:${pending.callId}:${pending.callerId}`,
        userId: pending.callerId,
        kind: 'call_cancel',
        correlationId: pending.callId,
        payload: { callId: pending.callId }
      });
    }
  }
  return res.json({ success: true });
});
