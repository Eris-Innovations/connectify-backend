import { Router } from 'express';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { healthRouter } from './health/health.routes';
import { authRouter } from './auth/auth.routes';
import { usersRouter } from './users/users.routes';
import { channelsRouter } from './channels/channels.routes';
import { kanbanRouter } from './kanban/kanban.routes';
import { secretPrekeyRouter } from './crypto/secret-prekey.routes';
import { UserModel } from './users/user.model';
import { ChannelModel } from './channels/channel.model';
import { CallModel } from './calls/call.model';
import { TranscriptModel } from './ai/transcript.model';
import { Types } from 'mongoose';
import { aiService } from './ai/ai.service';
import { ConversationModel } from './messages/conversation.model';
import { MessageModel } from './messages/message.model';
import { dmVirtualId, resolveVirtualConversationId } from '../lib/conversationIds';
import { parseDmVirtualUserPair } from '../lib/conversationAccess';
import { clampSearchQuery, escapeMongoRegex } from '../lib/mongoRegex';
import { threadsRouter } from './threads/threads.routes';
import { feedRouter } from './feed/feed.routes';
import { paymentsRouter } from './payments/payments.routes';
import { complianceRouter } from './compliance/compliance.routes';
import { adminRouter } from './admin/admin.routes';
import { aiAgentRouter } from './ai/agent.routes';
import { mediaRouter } from './media/media.routes';
import { resolveStoredMediaUrl } from '../lib/r2';
import { normalizePhone, phoneSearchPatterns } from '../lib/phone';
import { findDmMongoId, ensureDmConversation } from '../lib/dmConversation';
import { friendsRouter } from './friends/friends.routes';
import { areFriends } from './friends/friends.service';
import { callsRouter } from './calls/calls.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use(mediaRouter);
apiRouter.use(feedRouter);
apiRouter.use(channelsRouter);
apiRouter.use(kanbanRouter);
apiRouter.use(secretPrekeyRouter);
apiRouter.use(threadsRouter);
apiRouter.use(paymentsRouter);
apiRouter.use(complianceRouter);
apiRouter.use(adminRouter);
apiRouter.use(aiAgentRouter);
apiRouter.use('/friends', friendsRouter);
apiRouter.use('/calls', callsRouter);

// Chats & messages
apiRouter.get('/chats', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.auth!.userId;
    const conversations = await ConversationModel.find({
      participants: { $elemMatch: { userId, deletedAt: { $exists: false } } },
      isArchived: { $ne: true }
    })
      .populate('participants.userId', 'name avatar username settings.showLastSeen lastSeenAt')
      .populate('lastMessage.messageId')
      .sort({ lastActivityAt: -1 })
      .lean();

    const stripEnc = (s: string) => (s.startsWith('ENC:') ? s.slice(4) : s);
    const toParticipantUserId = (participant: any): string | null => {
      const rawUser = participant?.userId;
      if (!rawUser) return null;
      if (typeof rawUser === 'object' && rawUser._id) return String(rawUser._id);
      return String(rawUser);
    };

    const formattedRaw = await Promise.all(conversations.map(async (conv: any) => {
      const participants = Array.isArray(conv.participants) ? conv.participants : [];
      const populatedParticipants = participants.filter((p: any) => toParticipantUserId(p));
      const isDm = conv.type === 'dm';
      const otherParticipant = isDm
        ? populatedParticipants.find((p: any) => toParticipantUserId(p) !== userId)
        : null;
      const otherId = otherParticipant ? (toParticipantUserId(otherParticipant) ?? '') : '';
      const listId = isDm && otherId ? dmVirtualId(userId, otherId) : String(conv._id);

      const rawPreview = conv.lastMessage?.previewText ?? '';
      const otherUser =
        otherParticipant && typeof otherParticipant.userId === 'object' ? (otherParticipant.userId as any) : null;
      const otherAllowsLastSeen = Boolean(otherUser?.settings?.showLastSeen ?? true);
      const unreadCount = await MessageModel.countDocuments({
        conversationId: conv._id,
        senderId: { $ne: userId },
        readBy: { $ne: userId }
      });

      const avatar = isDm ? otherUser?.avatar : conv.avatar;
      const avatarUrl = avatar ? await resolveStoredMediaUrl(avatar) : avatar;
      const participantsWithAvatar = await Promise.all(
        populatedParticipants.map(async (p: any) => {
          const participantUserId = toParticipantUserId(p) as string;
          const participantUser = typeof p.userId === 'object' ? (p.userId as any) : null;
          const participantAvatar = participantUser?.avatar ?? '';
          return {
            id: participantUserId,
            name: participantUser?.name ?? 'User',
            avatar: participantAvatar ? await resolveStoredMediaUrl(participantAvatar) : ''
          };
        })
      );

      return {
        id: listId,
        peerUserId: isDm ? otherId : undefined,
        name: isDm ? otherUser?.name ?? 'User' : conv.title ?? 'Group',
        avatar: avatarUrl,
        isGroup: conv.type === 'group',
        lastMessage: stripEnc(rawPreview),
        lastMessageTime: conv.lastActivityAt,
        unreadCount,
        lastSeenAt: isDm && otherAllowsLastSeen ? otherUser?.lastSeenAt : undefined,
        isPinned: conv.isPinned,
        isSecret: conv.isSecret,
        participants: participantsWithAvatar
      };
    }));

    // Ensure one row per list conversation id (notably DM virtual ids) even if DB has duplicate DM docs.
    const formattedById = new Map<string, any>();
    for (const row of formattedRaw) {
      const current = formattedById.get(row.id);
      if (!current) {
        formattedById.set(row.id, row);
        continue;
      }
      const rowTime = row.lastMessageTime ? new Date(row.lastMessageTime).getTime() : 0;
      const curTime = current.lastMessageTime ? new Date(current.lastMessageTime).getTime() : 0;
      const rowHasAvatar = Boolean(typeof row.avatar === 'string' && row.avatar.trim().length > 0);
      const curHasAvatar = Boolean(typeof current.avatar === 'string' && current.avatar.trim().length > 0);
      if (!curHasAvatar && rowHasAvatar) {
        formattedById.set(row.id, row);
        continue;
      }
      if (rowTime >= curTime) formattedById.set(row.id, row);
    }
    const formatted = [...formattedById.values()].sort((a, b) => {
      const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return bTime - aTime;
    });

    const visibleChats = [];
    for (const row of formatted) {
      if (row.peerUserId && !(await areFriends(userId, row.peerUserId))) {
        continue;
      }
      visibleChats.push(row);
    }

    console.log(
      '[chats] response avatar snapshot',
      visibleChats.slice(0, 10).map((c: any) => ({
        id: c.id,
        name: c.name,
        avatar: c.avatar ? String(c.avatar).slice(0, 120) : ''
      }))
    );

    return res.json({ success: true, data: visibleChats });
  } catch (error) {
    console.error('Failed to fetch chats', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

apiRouter.post('/chats', requireAuth, async (req: AuthedRequest, res) => {
  const { targetUserId, isSecret } = req.body;
  if (!targetUserId) return res.status(400).json({ success: false, message: 'targetUserId required' });
  if (!Types.ObjectId.isValid(String(targetUserId))) {
    return res.status(400).json({ success: false, message: 'Invalid targetUserId' });
  }
  if (String(targetUserId) === req.auth!.userId) {
    return res.status(400).json({ success: false, message: 'Cannot chat with yourself' });
  }

  const friends = await areFriends(req.auth!.userId, String(targetUserId));
  if (!friends) {
    return res.status(403).json({
      success: false,
      message: 'You must be friends before starting a chat. Send a friend request first.'
    });
  }

  const virtualId = dmVirtualId(req.auth!.userId, targetUserId);

  const existing = await ConversationModel.findOne({
    type: 'dm',
    'participants.userId': { $all: [req.auth!.userId, targetUserId] }
  }).sort({ lastActivityAt: -1, _id: -1 });

  if (existing) {
    await ConversationModel.updateOne(
      { _id: existing._id },
      { $unset: { 'participants.$[me].deletedAt': '' } },
      { arrayFilters: [{ 'me.userId': new Types.ObjectId(req.auth!.userId) }] }
    );
    return res.json({ success: true, data: { id: virtualId, mongoId: String(existing._id) } });
  }

  const mongoId = await ensureDmConversation(req.auth!.userId, String(targetUserId), req.auth!.userId);
  return res.json({ success: true, data: { id: virtualId, mongoId } });
});

apiRouter.delete('/chats/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!paramId) {
      return res.status(400).json({ success: false, message: 'Conversation id required' });
    }
    const pair = parseDmVirtualUserPair(paramId);
    if (pair) {
      if (pair.a !== req.auth!.userId && pair.b !== req.auth!.userId) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      await ConversationModel.updateMany(
        {
          type: 'dm',
          'participants.userId': { $all: [pair.a, pair.b] }
        },
        { $set: { 'participants.$[me].deletedAt': new Date() } },
        { arrayFilters: [{ 'me.userId': new Types.ObjectId(req.auth!.userId) }] }
      );
      return res.json({ success: true, data: { id: paramId } });
    }

    const mongoConvId = await resolveVirtualConversationId(paramId);
    const conv = await ConversationModel.findById(mongoConvId).select('participants').lean();
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    const allowed = conv.participants.some((p: any) => String(p.userId) === req.auth!.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    await ConversationModel.updateOne(
      { _id: mongoConvId },
      { $set: { 'participants.$[me].deletedAt': new Date() } },
      { arrayFilters: [{ 'me.userId': new Types.ObjectId(req.auth!.userId) }] }
    );
    return res.json({ success: true, data: { id: paramId } });
  } catch (error) {
    console.error('Failed to delete chat for user', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

apiRouter.post('/chats/group', requireAuth, async (req: AuthedRequest, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const rawParticipants: unknown[] = Array.isArray(req.body.participants) ? req.body.participants : [];
  const trimmedIds = rawParticipants.map((pid: unknown) => String(pid).trim()).filter((id) => id.length > 0);
  const normalizedParticipants = [...new Set(trimmedIds)].filter(
    (pid: string) => pid !== req.auth!.userId && Types.ObjectId.isValid(pid)
  );

  if (!title) {
    return res.status(400).json({ success: false, message: 'Group title is required' });
  }
  if (normalizedParticipants.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'A group chat must include at least one other participant'
    });
  }

  const created = await ConversationModel.create({
    type: 'group',
    title,
    description,
    participants: [
      { userId: req.auth!.userId, role: 'admin' },
      ...normalizedParticipants.map((pid) => ({ userId: pid, role: 'member' }))
    ],
    createdBy: req.auth!.userId
  });
  return res.json({ success: true, data: { id: String(created._id) } });
});

apiRouter.get('/chats/:id/messages', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!paramId) {
      return res.status(400).json({ success: false, message: 'Conversation id required' });
    }
    const pair = parseDmVirtualUserPair(paramId);
    let mongoConvId: string;
    if (pair) {
      const found = await findDmMongoId(pair.a, pair.b);
      if (!found) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }
      if (!(await areFriends(pair.a, pair.b))) {
        return res.status(403).json({
          success: false,
          message: 'Accept the friend request to start chatting.'
        });
      }
      mongoConvId = found;
    } else {
      mongoConvId = paramId;
    }

    const conv = await ConversationModel.findById(mongoConvId).select('participants type').lean();
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    const allowed = conv.participants.some((p: any) => String(p.userId) === req.auth!.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const me = conv.participants.find((p: any) => String(p.userId) === req.auth!.userId);
    if (me?.deletedAt) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const listChatId = paramId.startsWith('dm:') ? paramId : String(mongoConvId);

    const messages = await MessageModel.find({ conversationId: mongoConvId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const participantIds = conv.participants.map((p: any) => String(p.userId));
    const visibleMessages =
      (conv as any).type === 'dm'
        ? messages.filter((m: any) => {
            const senderId = String(m.senderId);
            const receiverId = participantIds.find((pid) => pid !== senderId);
            if (!receiverId) return true;
            const readBy = Array.isArray(m.readBy) ? m.readBy.map((id: any) => String(id)) : [];
            // Keep in DB, hide from chat screen once receiver has read it.
            return !readBy.includes(receiverId);
          })
        : messages;

    const stripEnc = (s: string) => (typeof s === 'string' && s.startsWith('ENC:') ? s.slice(4) : s);

    const data = await Promise.all(
      visibleMessages.map(async (m: any) => ({
        id: String(m._id),
        chatId: listChatId,
        senderId: String(m.senderId),
        text: stripEnc(m.content?.text ?? ''),
        media: m.content?.mediaUrl
          ? {
              type: m.content.mediaType,
              uri: await resolveStoredMediaUrl(m.content.mediaUrl),
              duration: m.content.metadata?.durationSec,
              name: m.content.metadata?.name,
              size: m.content.metadata?.size
            }
          : undefined,
        timestamp: m.createdAt,
        status: 'sent'
      }))
    );

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Failed to fetch messages', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
apiRouter.delete('/messages/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const messageId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!messageId || !Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message id' });
    }

    const message = await MessageModel.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const conv = await ConversationModel.findById(message.conversationId).select('participants').lean();
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    const isParticipant = conv.participants.some((p: any) => String(p.userId) === req.auth!.userId);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (String(message.senderId) !== req.auth!.userId) {
      return res.status(403).json({ success: false, message: 'Only the sender can delete this message' });
    }

    const conversationId = String(message.conversationId);
    const deletingLast =
      String((await ConversationModel.findById(conversationId).select('lastMessage.messageId').lean())?.lastMessage?.messageId ?? '') ===
      String(message._id);

    await message.deleteOne();

    if (deletingLast) {
      const latest = await MessageModel.findOne({ conversationId }).sort({ createdAt: -1 }).lean();
      if (latest) {
        await ConversationModel.findByIdAndUpdate(conversationId, {
          lastActivityAt: latest.createdAt,
          lastMessage: {
            messageId: latest._id,
            senderId: latest.senderId,
            previewText: latest.content?.text?.slice(0, 200) ?? '',
            createdAt: latest.createdAt
          }
        }).exec();
      } else {
        await ConversationModel.findByIdAndUpdate(conversationId, {
          $unset: { lastMessage: 1 },
          lastActivityAt: new Date()
        }).exec();
      }
    }

    return res.json({ success: true, data: { id: messageId } });
  } catch (error) {
    console.error('Failed to delete message', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Calls
apiRouter.post('/calls/initiate', requireAuth, async (req: AuthedRequest, res) => {
  const receiverId = typeof req.body.receiverId === 'string' ? req.body.receiverId : '';
  const receiverName = typeof req.body.receiverName === 'string' ? req.body.receiverName : 'Unknown';
  const isVideo = Boolean(req.body.isVideo);
  if (!receiverId) {
    return res.status(400).json({ success: false, message: 'receiverId is required' });
  }

  const created = await CallModel.create({
    callerId: req.auth!.userId,
    receiverId,
    type: 'outgoing',
    isVideo
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(created._id),
      userId: receiverId,
      userName: receiverName,
      type: 'outgoing',
      timestamp: created.createdAt,
      duration: created.duration
    }
  });
});

apiRouter.post('/calls/:id/recap', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const callId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!callId || !Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: 'Invalid call id' });
    }
    const recap = await aiService.generateMeetingRecap(callId);
    return res.status(201).json({ success: true, data: recap });
  } catch (error) {
    console.error('Failed to generate recap', error);
    return res.status(500).json({ success: false, message: 'Failed to generate recap' });
  }
});

apiRouter.post('/calls/:id/transcript', requireAuth, async (req: AuthedRequest, res) => {
  const callSessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawText = typeof req.body.rawText === 'string' ? req.body.rawText : '';
  const language = typeof req.body.language === 'string' ? req.body.language : 'en';

  if (!callSessionId || !Types.ObjectId.isValid(callSessionId)) {
    return res.status(400).json({ success: false, message: 'Invalid call id' });
  }
  if (!rawText.trim()) {
    return res.status(400).json({ success: false, message: 'rawText is required' });
  }

  const created = await TranscriptModel.create({
    userId: new Types.ObjectId(req.auth!.userId),
    callSessionId: new Types.ObjectId(callSessionId),
    kind: 'call',
    rawText: rawText.trim(),
    language,
    source: 'device'
  });

  return res.status(201).json({ success: true, data: created });
});

apiRouter.get('/calls/history', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const logs = await CallModel.find({
    $or: [{ callerId: userId }, { receiverId: userId }]
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const userIds = [...new Set(logs.flatMap((log) => [String(log.callerId), String(log.receiverId)]))];
  const users = await UserModel.find({ _id: { $in: userIds } }).lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));

  return res.json({
    success: true,
    data: logs.map((log) => {
      const isCaller = String(log.callerId) === userId;
      const otherId = isCaller ? String(log.receiverId) : String(log.callerId);
      return {
        id: String(log._id),
        userId: otherId,
        userName: names.get(otherId) ?? 'Unknown',
        type: isCaller ? 'outgoing' : 'incoming',
        timestamp: log.createdAt,
        duration: log.duration ?? 0,
        isVideo: log.isVideo
      };
    })
  });
});

apiRouter.delete('/calls/history', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  await CallModel.deleteMany({
    $or: [{ callerId: userId }, { receiverId: userId }]
  });
  return res.json({ success: true });
});

apiRouter.get('/search', requireAuth, async (req, res) => {
  const qInput = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const q = clampSearchQuery(qInput);
  const type = typeof req.query.type === 'string' ? req.query.type : 'all';

  const literal = q ? escapeMongoRegex(q) : '';
  const orConditions: Record<string, unknown>[] = [];

  if (literal) {
    orConditions.push(
      { name: { $regex: literal, $options: 'i' } },
      { username: { $regex: literal, $options: 'i' } },
      { bio: { $regex: literal, $options: 'i' } }
    );

    for (const pattern of phoneSearchPatterns(qInput)) {
      orConditions.push({ phone: { $regex: escapeMongoRegex(pattern) } });
    }

    const exactPhone = normalizePhone(qInput);
    if (exactPhone) {
      orConditions.push({ phone: exactPhone });
    }
  }

  const query = orConditions.length ? { $or: orConditions } : {};

  const users = type === 'channels' ? [] : await UserModel.find(query).limit(20).lean();
  const channels =
    type === 'users' ? [] : await ChannelModel.find(literal ? { name: { $regex: literal, $options: 'i' } } : {}).limit(20).lean();
  const usersWithAvatar = await Promise.all(
    users.map(async (u) => ({
      id: String(u._id),
      name: u.name,
      username: u.username,
      phone: u.phone ?? '',
      avatarUrl: u.avatar ? await resolveStoredMediaUrl(u.avatar) : ''
    }))
  );

  return res.json({
    success: true,
    data: {
      users: usersWithAvatar,
      channels: channels.map((c) => ({
        id: String(c._id),
        name: c.name,
        description: c.description,
        icon: c.icon,
        color: c.color,
        members: `${c.members.length}`
      })),
      posts: [] as { id: string; caption: string; imageUrl: string }[]
    }
  });
});

// Admin (user list + activities live on adminRouter)
apiRouter.put('/admin/users/:id/ban', requireAdmin, async (req, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  user.settings.notificationsEnabled = false;
  await user.save();
  return res.json({ success: true, message: 'User flagged by admin action' });
});
apiRouter.get('/admin/reports', requireAuth, (_req, res) => res.json({ success: true, message: 'Moved to /admin/moderation/reports' }));
apiRouter.get('/admin/analytics', requireAuth, (_req, res) => res.json({ success: true, message: 'Moved to /admin/analytics/overview' }));
