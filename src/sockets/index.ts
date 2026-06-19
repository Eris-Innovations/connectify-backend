import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { resolveCorsOrigin } from '../config/cors';
import { redis } from '../config/redis';
import { ConversationModel } from '../modules/messages/conversation.model';
import { MessageModel } from '../modules/messages/message.model';
import { UserModel } from '../modules/users/user.model';
import { resolveConversationForMember } from '../lib/conversationAccess';
import { getDmPeerUserId } from '../lib/dmConversation';
import { areFriends } from '../modules/friends/friends.service';
import { scheduleVoiceMessageTranscription } from '../modules/ai/whisper.service';
import { resolveStoredMediaUrl } from '../lib/r2';
import { setSocketIo } from './io';

type SocketAuthPayload = {
  userId: string;
};

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: resolveCorsOrigin,
      credentials: true
    }
  });
  setSocketIo(io);

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Missing token'));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as SocketAuthPayload;
      socket.data.userId = payload.userId;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userRoom = `user:${socket.data.userId as string}`;
    socket.join(userRoom);

    const userId = socket.data.userId as string;
    
    const isUserConnected = (uid: string) => {
      const room = io.sockets.adapter.rooms.get(`user:${uid}`);
      return Boolean(room && room.size > 0);
    };
    const getShowLastSeenEnabled = async (uid: string): Promise<boolean> => {
      try {
        const row = await UserModel.findById(uid).select('settings.showLastSeen').lean();
        return row?.settings?.showLastSeen !== false;
      } catch {
        return true;
      }
    };

    // Basic presence: mark user online with 30s TTL and refresh every 20s
    const presenceKey = `user:${userId}:online`;
    const refreshPresence = async () => {
      try {
        await redis.set(presenceKey, '1', 'EX', 30);
      } catch {
        // Presence is best-effort; ignore failures
      }
    };
    const notifyPresenceWatchers = async (online: boolean, lastSeenAt?: Date) => {
      const ownerAllows = await getShowLastSeenEnabled(userId);
      console.log('[socket.presence.notify]', {
        userId,
        ownerAllows,
        online,
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : '',
      });
      io.to(`pw:${userId}`).emit('presence:update', {
        userId,
        online: ownerAllows ? online : false,
        hidden: !ownerAllows,
        lastSeenAt: ownerAllows && lastSeenAt ? lastSeenAt.toISOString() : undefined,
      });
    };

    socket.on('privacy:presence-updated', async () => {
      const online = isUserConnected(userId);
      const snapshot = await UserModel.findById(userId).select('lastSeenAt').lean();
      const lastSeenAt = online
        ? undefined
        : snapshot?.lastSeenAt
          ? new Date(snapshot.lastSeenAt)
          : new Date();
      console.log('[socket.privacy:presence-updated]', {
        userId,
        online,
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : '',
      });
      await notifyPresenceWatchers(online, lastSeenAt);
    });
    void (async () => {
      await refreshPresence();
      await notifyPresenceWatchers(true);
    })();
    const presenceInterval = setInterval(() => {
      void refreshPresence();
    }, 20_000);

    socket.on('presence:watch', async (payload: { userIds?: string[] }) => {
      const raw = Array.isArray(payload?.userIds) ? payload.userIds : [];
      const ids = [...new Set(raw.map((id) => String(id)).filter(Boolean))];
      const prev: string[] = Array.isArray((socket.data as { presenceWatchedIds?: string[] }).presenceWatchedIds)
        ? (socket.data as { presenceWatchedIds: string[] }).presenceWatchedIds
        : [];
      for (const id of prev) {
        socket.leave(`pw:${id}`);
      }
      (socket.data as { presenceWatchedIds: string[] }).presenceWatchedIds = ids;
      for (const id of ids) {
        socket.join(`pw:${id}`);
      }
      const states: { userId: string; online: boolean; hidden?: boolean; lastSeenAt?: string }[] = [];
      const watcherAllows = await getShowLastSeenEnabled(userId);
      for (const id of ids) {
        try {
          if (!watcherAllows) {
            states.push({ userId: id, online: false, hidden: true });
            continue;
          }
          const v = await redis.get(`user:${id}:online`);
          const online = v ? true : isUserConnected(id);
          const peer = await UserModel.findById(id).select('lastSeenAt settings.showLastSeen').lean();
          const peerAllows = peer?.settings?.showLastSeen !== false;
          if (!peerAllows) {
            states.push({ userId: id, online: false, hidden: true });
            continue;
          }
          if (online) {
            states.push({ userId: id, online: true });
          } else {
            states.push({
              userId: id,
              online: false,
              lastSeenAt: peer?.lastSeenAt ? new Date(peer.lastSeenAt).toISOString() : undefined,
            });
          }
        } catch {
          states.push({ userId: id, online: isUserConnected(id) });
        }
      }
      socket.emit('presence:batch', { states });
    });

    socket.on('disconnect', async () => {
      clearInterval(presenceInterval);
      const stillOnline = isUserConnected(userId);
      const lastSeenAt = stillOnline ? undefined : new Date();
      if (lastSeenAt) {
        await UserModel.findByIdAndUpdate(userId, { $set: { lastSeenAt } }).exec();
      }
      await notifyPresenceWatchers(stillOnline, lastSeenAt);
      try {
        if (stillOnline) {
          await redis.set(presenceKey, '1', 'EX', 30);
        } else {
          await redis.del(presenceKey);
        }
      } catch {
        // Ignore
      }
    });

    socket.on('chat:join', async (conversationId: string) => {
      const raw = typeof conversationId === 'string' ? conversationId.trim() : '';
      if (!raw) return;
      if (!(await resolveConversationForMember(userId, raw))) return;
      socket.join(raw);
    });

    socket.on(
      'message:send',
      async (payload: {
        conversationId: string;
        content?: string;
        clientId?: string;
        mediaUrl?: string;
        mediaType?: string;
        mediaMetadata?: { durationSec?: number; name?: string; size?: number };
      }) => {
        const now = new Date();
        const senderId = userId;

        const text = typeof payload.content === 'string' ? payload.content : '';
        const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl.trim() : '';
        const allowedTypes = new Set(['image', 'video', 'file', 'voice']);
        const rawType = typeof payload.mediaType === 'string' ? payload.mediaType.trim() : '';
        const mediaType =
          mediaUrl && allowedTypes.has(rawType) ? rawType : mediaUrl ? 'file' : 'text';

        if (!text.trim() && !mediaUrl) {
          return;
        }

        const metaRaw =
          payload.mediaMetadata && typeof payload.mediaMetadata === 'object' ? payload.mediaMetadata : null;
        const metadata: { durationSec?: number; name?: string; size?: number } = {};
        if (metaRaw) {
          if (typeof metaRaw.durationSec === 'number') {
            metadata.durationSec = Math.min(3600, Math.max(0, Math.floor(metaRaw.durationSec)));
          }
          if (typeof metaRaw.name === 'string' && metaRaw.name.trim()) {
            metadata.name = metaRaw.name.trim().slice(0, 200);
          }
          if (typeof metaRaw.size === 'number') {
            metadata.size = Math.min(50 * 1024 * 1024, Math.max(0, Math.floor(metaRaw.size)));
          }
        }
        const metadataForDb = Object.keys(metadata).length ? metadata : undefined;

        const rawConv = typeof payload.conversationId === 'string' ? payload.conversationId.trim() : '';
        if (!rawConv) return;

        const dbConversationId = await resolveConversationForMember(senderId, rawConv);
        if (!dbConversationId) return;

        const convMeta = await ConversationModel.findById(dbConversationId).select('type').lean();
        if (convMeta?.type === 'dm') {
          const peerId = await getDmPeerUserId(dbConversationId, senderId);
          if (!peerId || !(await areFriends(senderId, peerId))) {
            return;
          }
        }

        const created = await MessageModel.create({
          conversationId: dbConversationId,
          senderId,
          content: {
            text,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaUrl ? mediaType : 'text',
            metadata: metadataForDb
          },
          type: 'message'
        });

        if (mediaType === 'voice' && mediaUrl) {
          scheduleVoiceMessageTranscription({
            userId: senderId,
            mediaUrl,
            conversationId: String(dbConversationId),
            messageId: String(created._id)
          });
        }

        const previewText = mediaUrl
          ? mediaType === 'voice'
            ? '🎤 Voice message'
            : mediaType === 'image'
              ? '📷 Photo'
              : mediaType === 'video'
                ? '🎥 Video'
                : '📎 File'
          : text.slice(0, 200);

        await ConversationModel.findByIdAndUpdate(dbConversationId, {
          lastActivityAt: now,
          lastMessage: {
            messageId: created._id,
            senderId,
            previewText,
            createdAt: created.createdAt
          },
          $unset: { 'participants.$[].deletedAt': '' }
        }).exec();

        const senderDoc = await UserModel.findById(senderId).select('name username avatar').lean();
        const senderAvatarUrl = senderDoc?.avatar ? await resolveStoredMediaUrl(senderDoc.avatar) : '';
        const senderPreview = senderDoc
          ? {
              id: String(senderDoc._id),
              name: senderDoc.name,
              username: senderDoc.username,
              avatarUrl: senderAvatarUrl
            }
          : { id: senderId, name: 'User', username: '', avatarUrl: '' };

        const serverPayload = {
          conversationId: rawConv,
          messageId: String(created._id),
          senderId,
          content: text,
          media: mediaUrl
            ? {
                uri: mediaUrl,
                type: mediaType,
                durationSec: metadata.durationSec,
                name: metadata.name,
                size: metadata.size
              }
            : undefined,
          createdAt: created.createdAt.toISOString(),
          clientId: payload.clientId,
          senderPreview
        };

        socket.emit('message:ack', {
          clientId: payload.clientId,
          serverMessageId: String(created._id),
          receivedAt: now.toISOString()
        });
        console.log('[socket.message:ack]', {
          senderId,
          conversationId: rawConv,
          clientId: payload.clientId,
          serverMessageId: String(created._id),
        });

        const convDoc = await ConversationModel.findById(dbConversationId).select('participants').lean();
        const recipientIds = new Set<string>();
        if (convDoc?.participants?.length) {
          for (const p of convDoc.participants) {
            recipientIds.add(String(p.userId));
          }
        } else {
          recipientIds.add(senderId);
        }
        recipientIds.forEach((pid) => {
          io.to(`user:${pid}`).emit('message:new', serverPayload);
          io.to(`user:${pid}`).emit('chats:resync');
        });

        const deliveredRecipients = [...recipientIds].filter(
          (pid) => pid !== senderId && isUserConnected(pid)
        );
        if (deliveredRecipients.length > 0) {
          const deliveredPayload = {
            conversationId: rawConv,
            messageIds: [String(created._id)],
            clientId: payload.clientId,
            recipientIds: deliveredRecipients,
          };
          io.to(`user:${senderId}`).emit('message:delivered', deliveredPayload);
          console.log('[socket.message:delivered]', {
            senderId,
            conversationId: rawConv,
            clientId: payload.clientId,
            messageId: String(created._id),
            recipientIds: deliveredRecipients,
          });
        }
      }
    );

    socket.on('chat:seen', async (payload: { conversationId?: string }) => {
      try {
        const rawConversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : '';
        if (!rawConversationId) return;

        const dbConversationId = await resolveConversationForMember(userId, rawConversationId);
        if (!dbConversationId) return;

        const conv = await ConversationModel.findById(dbConversationId).select('type participants').lean();
        if (!conv || conv.type !== 'dm' || !Array.isArray(conv.participants) || conv.participants.length < 2) {
          return;
        }

        const participantIds = conv.participants.map((p) => String(p.userId));

        // Only consume messages that were sent by the peer and not yet marked read by this user.
        const unreadFromPeer = await MessageModel.find({
          conversationId: dbConversationId,
          senderId: { $ne: userId },
          readBy: { $ne: userId }
        })
          .select('_id')
          .lean();

        if (!unreadFromPeer.length) return;
        const consumedIds = unreadFromPeer.map((m) => String(m._id));

        await MessageModel.updateMany(
          { _id: { $in: unreadFromPeer.map((m) => m._id) } },
          {
            $addToSet: { readBy: userId },
            $set: { readAt: new Date() }
          }
        );

        const reader = await UserModel.findById(userId).select('settings.readReceiptsEnabled').lean();
        const readReceiptsEnabled = reader?.settings?.readReceiptsEnabled !== false;
        console.log('[socket.chat:seen] receipt preference', {
          userId,
          conversationId: rawConversationId,
          readReceiptsEnabled,
          consumedCount: consumedIds.length,
        });
        if (!readReceiptsEnabled) {
          // Mark as read server-side for unread counters, but do not reveal seen-state to peers.
          return;
        }

        const consumePayload = {
          conversationId: rawConversationId,
          messageIds: consumedIds,
          readerId: userId
        };
        for (const pid of participantIds) {
          io.to(`user:${pid}`).emit('message:consumed', consumePayload);
        }
      } catch (error) {
        console.error('Failed to process chat:seen', error);
      }
    });

    socket.on('typing:started', async (payload: { conversationId?: string }) => {
      const raw = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
      if (!raw || !(await resolveConversationForMember(userId, raw))) return;
      socket.to(raw).emit('typing:notify', {
        conversationId: raw,
        userId,
        isTyping: true
      });
    });

    socket.on('typing:stopped', async (payload: { conversationId?: string }) => {
      const raw = typeof payload?.conversationId === 'string' ? payload.conversationId.trim() : '';
      if (!raw || !(await resolveConversationForMember(userId, raw))) return;
      socket.to(raw).emit('typing:notify', {
        conversationId: raw,
        userId,
        isTyping: false
      });
    });

    socket.on('call:initiate', (payload: { to: string; callerName?: string; offer: unknown }) => {
      io.to(`user:${payload.to}`).emit('call:invitation', {
        fromId: socket.data.userId,
        fromName: payload.callerName ?? 'Unknown',
        offer: payload.offer
      });
    });

    socket.on('call:accept', (payload: { to: string; answer: unknown }) => {
      io.to(`user:${payload.to}`).emit('call:accepted', {
        answer: payload.answer
      });
    });

    socket.on('ice-candidate', (payload: { to: string; candidate: unknown }) => {
      io.to(`user:${payload.to}`).emit('ice-candidate', {
        candidate: payload.candidate
      });
    });

    socket.on('call:end', (payload: { to: string }) => {
      io.to(`user:${payload.to}`).emit('call:ended');
    });
  });

  return io;
}
