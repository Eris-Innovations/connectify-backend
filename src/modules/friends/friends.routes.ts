import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { dmVirtualId } from '../../lib/conversationIds';
import { emitToUser, shouldDeliverPushToUser } from '../../sockets/io';
import { getExpoPushTokensForUser, sendFriendRequestPush } from '../../lib/expoPush';
import { UserModel } from '../users/user.model';
import {
  acceptFriendRequest,
  getFriendRelationship,
  ignoreFriendRequest,
  listFriendRequests,
  sendFriendRequest
} from './friends.service';

export const friendsRouter = Router();

friendsRouter.get('/requests', requireAuth, async (req: AuthedRequest, res) => {
  const data = await listFriendRequests(req.auth!.userId);
  return res.status(StatusCodes.OK).json({ success: true, data });
});

friendsRouter.get('/status/:userId', requireAuth, async (req: AuthedRequest, res) => {
  const otherUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!otherUserId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'userId required' });
  }
  const relationship = await getFriendRelationship(req.auth!.userId, otherUserId);
  return res.status(StatusCodes.OK).json({ success: true, data: relationship });
});

friendsRouter.post('/requests', requireAuth, async (req: AuthedRequest, res) => {
  const targetUserId = typeof req.body.targetUserId === 'string' ? req.body.targetUserId.trim() : '';
  if (!targetUserId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'targetUserId required' });
  }

  const result = await sendFriendRequest(req.auth!.userId, targetUserId);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message });
  }

  emitToUser(targetUserId, 'friend-request:new', {
    connectionId: result.data.id,
    fromUserId: req.auth!.userId
  });

  if (shouldDeliverPushToUser(targetUserId)) {
    void (async () => {
      const tokens = await getExpoPushTokensForUser(targetUserId);
      if (tokens.length === 0) {
        console.warn('[push.friend_request] skipped — no tokens', { targetUserId });
        return;
      }
      const sender = await UserModel.findById(req.auth!.userId).select('name username').lean();
      const fromName = sender?.name || sender?.username || 'Someone';
      console.log('[push.friend_request] sending', { targetUserId, tokenCount: tokens.length });
      await sendFriendRequestPush(tokens, {
        fromName,
        fromUserId: req.auth!.userId,
        connectionId: result.data.id,
      });
    })();
  }

  return res.status(StatusCodes.CREATED).json({ success: true, data: result.data });
});

friendsRouter.post('/requests/:id/accept', requireAuth, async (req: AuthedRequest, res) => {
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

  return res.status(StatusCodes.OK).json({
    success: true,
    data: { peerUserId: result.data.peerUserId, chatId }
  });
});

friendsRouter.post('/requests/:id/ignore', requireAuth, async (req: AuthedRequest, res) => {
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
});
