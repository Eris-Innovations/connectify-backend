import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { clearPendingCall, getPendingCall } from './pending-call.service';
import { emitToUser } from '../../sockets/io';

export const callsRouter = Router();

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
  return res.json({ success: true });
});
