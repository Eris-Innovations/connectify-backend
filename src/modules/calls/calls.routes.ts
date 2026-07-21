import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import {
  clearPendingCall,
  getPendingCall,
  getPendingCallByCaller,
} from './pending-call.service';
import { getActiveCall } from './active-call.service';
import { emitToUser } from '../../sockets/io';
import { getCloudflareIceServers } from './ice-servers.service';
import { enqueueNotification } from '../notifications/notification-outbox.service';
import { isLiveKitConfigured, mintLiveKitToken } from './livekit.service';
import { UserModel } from '../users/user.model';

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
      offer: pending.offer ?? null,
      createdAt: pending.createdAt,
      media: 'livekit',
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
      payload: { callId: pending.callId },
    });
    if (pending.callerId) {
      void enqueueNotification({
        eventId: `call_cancel:${pending.callId}:${pending.callerId}`,
        userId: pending.callerId,
        kind: 'call_cancel',
        correlationId: pending.callId,
        payload: { callId: pending.callId },
      });
    }
  }
  return res.json({ success: true });
});

/**
 * Mint a short-lived LiveKit JWT for an active or pending call the user belongs to.
 * Tokens are never sent over FCM — clients fetch after wake/accept.
 */
callsRouter.post('/:callId/livekit-token', requireAuth, async (req: AuthedRequest, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'LiveKit media is not configured on this server.',
    });
  }

  const callId = Array.isArray(req.params.callId) ? req.params.callId[0] : req.params.callId;
  if (!callId || !callId.trim()) {
    return res.status(400).json({ success: false, message: 'callId is required' });
  }

  const userId = req.auth!.userId;
  const [active, pendingAsCallee, pendingAsCaller] = await Promise.all([
    getActiveCall(userId),
    getPendingCall(userId),
    getPendingCallByCaller(userId),
  ]);

  const allowed =
    (active && active.callId === callId) ||
    (pendingAsCallee && pendingAsCallee.callId === callId) ||
    (pendingAsCaller && pendingAsCaller.record.callId === callId);

  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized for this call.',
    });
  }

  try {
    const user = await UserModel.findById(userId).select('name').lean();
    const minted = await mintLiveKitToken({
      callId,
      identity: userId,
      displayName: typeof user?.name === 'string' ? user.name : undefined,
    });
    return res.json({
      success: true,
      data: {
        url: minted.url,
        token: minted.token,
        roomName: minted.roomName,
        callId,
      },
    });
  } catch (error) {
    console.error('[livekit-token] failed', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mint LiveKit token.',
    });
  }
});
