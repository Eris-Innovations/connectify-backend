import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { dmVirtualId } from '../../lib/conversationIds';
import { emitToUser } from '../../sockets/io';
import { UserModel } from '../users/user.model';
import { enqueueNotification } from '../notifications/notification-outbox.service';
import {
  acceptFriendRequest,
  getFriendRelationship,
  ignoreFriendRequest,
  listFriends,
  listFriendRequests,
  sendFriendRequest
} from './friends.service';
import { asyncHandler } from '../../shared/errors';

export const friendsRouter = Router();

friendsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = await listFriends(req.auth!.userId);
    return res.status(StatusCodes.OK).json({ success: true, data });
  })
);

friendsRouter.get('/requests', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const data = await listFriendRequests(req.auth!.userId);
  return res.status(StatusCodes.OK).json({ success: true, data });
}));

friendsRouter.get('/status/:userId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const otherUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!otherUserId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'userId required' });
  }
  const relationship = await getFriendRelationship(req.auth!.userId, otherUserId);
  return res.status(StatusCodes.OK).json({ success: true, data: relationship });
}));

friendsRouter.post('/requests', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const targetUserId = typeof req.body.targetUserId === 'string' ? req.body.targetUserId.trim() : '';
  if (!targetUserId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'targetUserId required' });
  }

  const result = await sendFriendRequest(req.auth!.userId, targetUserId);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message });
  }

  // Only notify on a real state transition (new / re-opened request).
  if (result.data.created) {
    emitToUser(targetUserId, 'friend-request:new', {
      connectionId: result.data.id,
      fromUserId: req.auth!.userId
    });

    void (async () => {
      const sender = await UserModel.findById(req.auth!.userId).select('name username').lean();
      const fromName = sender?.name || sender?.username || 'Someone';
      await enqueueNotification({
        eventId: `friend_request:${result.data.id}:${targetUserId}:${result.data.notifyEpoch}`,
        userId: targetUserId,
        kind: 'friend_request',
        correlationId: result.data.id,
        payload: {
          fromName,
          fromUserId: req.auth!.userId,
          connectionId: result.data.id
        }
      });
    })();
  }

  return res.status(StatusCodes.CREATED).json({ success: true, data: result.data });
}));

friendsRouter.post('/requests/:id/accept', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const connectionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await acceptFriendRequest(connectionId, req.auth!.userId);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message });
  }

  const chatId = dmVirtualId(req.auth!.userId, result.data.peerUserId);
  emitToUser(result.data.peerUserId, 'friend-request:accepted', {
    connectionId,
    peerUserId: req.auth!.userId,
    chatId
  });

  void (async () => {
    const accepter = await UserModel.findById(req.auth!.userId).select('name username').lean();
    const accepterName = accepter?.name || accepter?.username || 'Someone';
    await enqueueNotification({
      eventId: `friend_request_accepted:${connectionId}:${result.data.peerUserId}`,
      userId: result.data.peerUserId,
      kind: 'friend_request_accepted',
      correlationId: connectionId,
      payload: {
        accepterName,
        accepterUserId: req.auth!.userId,
        chatId
      }
    });
  })();

  return res.status(StatusCodes.OK).json({
    success: true,
    data: { peerUserId: result.data.peerUserId, chatId }
  });
}));

friendsRouter.post('/requests/:id/ignore', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const connectionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await ignoreFriendRequest(connectionId, req.auth!.userId);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message });
  }

  emitToUser(result.data.peerUserId, 'friend-request:ignored', {
    connectionId,
    peerUserId: req.auth!.userId
  });

  return res.status(StatusCodes.OK).json({ success: true, data: { peerUserId: result.data.peerUserId } });
}));
