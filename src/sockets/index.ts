import type { Server as HttpServer } from 'http';
import { Types } from 'mongoose';
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
import { clearPendingCall, clearPendingCallByCaller, getPendingCall, storePendingCall } from '../modules/calls/pending-call.service';
import {
  clearActiveCall,
  clearActiveCallPair,
  getActiveCall,
  setActiveCall,
} from '../modules/calls/active-call.service';
import { authorizeCallEnd } from '../modules/calls/call-authorization';
import { setSocketIo, setUserAppForeground, clearUserAppForeground } from './io';
import { enqueueNotification } from '../modules/notifications/notification-outbox.service';

type SocketAuthPayload = {
  userId: string;
};

/** Grace period before ending an active call after the last socket disconnects (transient blips). */
const ACTIVE_CALL_DISCONNECT_GRACE_MS = 12_000;
const pendingActiveCallEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelPendingActiveCallEnd(userId: string): void {
  const timer = pendingActiveCallEndTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingActiveCallEndTimers.delete(userId);
  }
}

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
    cancelPendingActiveCallEnd(userId);
    setUserAppForeground(userId, true);

    socket.on('app:state', (payload: { state?: string }) => {
      const raw = typeof payload?.state === 'string' ? payload.state : '';
      const foreground = raw === 'active';
      setUserAppForeground(userId, foreground);
      console.log('[socket.app:state]', { userId, state: raw, foreground });
    });
    
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
      // Watcher's own showLastSeen only controls what *others* see about them —
      // it must not hide everyone else's presence from this watcher.
      const states: { userId: string; online: boolean; hidden?: boolean; lastSeenAt?: string }[] = [];
      for (const id of ids) {
        try {
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
      if (!stillOnline) {
        clearUserAppForeground(userId);
      }
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

      const cancelledCall = await clearPendingCallByCaller(userId);
      if (cancelledCall) {
        io.to(`user:${cancelledCall.receiverId}`).emit('call:ended', {
          callId: cancelledCall.record.callId,
          reason: 'unavailable',
        });
      }

      // Do not tear down an in-progress call on a brief socket blip — wait for grace, then re-check.
      if (!stillOnline) {
        cancelPendingActiveCallEnd(userId);
        const graceTimer = setTimeout(() => {
          pendingActiveCallEndTimers.delete(userId);
          void (async () => {
            if (isUserConnected(userId)) return;
            const activeCall = await getActiveCall(userId);
            if (!activeCall) return;
            await clearActiveCall(userId);
            if (activeCall.otherUserId) {
              io.to(`user:${activeCall.otherUserId}`).emit('call:ended', {
                callId: activeCall.callId,
                reason: 'unavailable',
              });
              await clearActiveCall(activeCall.otherUserId);
              cancelPendingActiveCallEnd(activeCall.otherUserId);
            }
            console.log('[socket.call.disconnect.grace.end]', {
              userId,
              callId: activeCall.callId,
              otherUserId: activeCall.otherUserId,
            });
          })();
        }, ACTIVE_CALL_DISCONNECT_GRACE_MS);
        pendingActiveCallEndTimers.set(userId, graceTimer);
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
        replyToMessageId?: string;
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

        const convMeta = await ConversationModel.findById(dbConversationId)
          .select('type title disappearingMessagesSeconds')
          .lean();
        if (convMeta?.type === 'dm') {
          const peerId = await getDmPeerUserId(dbConversationId, senderId);
          if (!peerId || !(await areFriends(senderId, peerId))) {
            return;
          }
        }

        let replyTo:
          | { messageId: Types.ObjectId; senderId: Types.ObjectId; previewText: string; mediaType?: string }
          | undefined;
        const replyId = typeof payload.replyToMessageId === 'string' ? payload.replyToMessageId.trim() : '';
        if (replyId && Types.ObjectId.isValid(replyId)) {
          const referenced = await MessageModel.findOne({ _id: replyId, conversationId: dbConversationId }).lean();
          if (referenced) {
            replyTo = {
              messageId: referenced._id,
              senderId: referenced.senderId,
              previewText: String(referenced.content?.text ?? '').slice(0, 160),
              mediaType: referenced.content?.mediaType
            };
          }
        }
        const disappearingSeconds = Number(convMeta?.disappearingMessagesSeconds ?? 0);
        const expiresAt = disappearingSeconds > 0
          ? new Date(now.getTime() + disappearingSeconds * 1000)
          : undefined;

        const clientId =
          typeof payload.clientId === 'string' && payload.clientId.trim()
            ? payload.clientId.trim().slice(0, 120)
            : undefined;

        let created;
        if (clientId) {
          try {
            created = await MessageModel.create({
              conversationId: dbConversationId,
              senderId,
              clientId,
              content: {
                text,
                mediaUrl: mediaUrl || undefined,
                mediaType: mediaUrl ? mediaType : 'text',
                metadata: metadataForDb
              },
              type: 'message',
              replyTo,
              expiresAt
            });
          } catch (error: any) {
            if (error?.code === 11000) {
              created = await MessageModel.findOne({ senderId, clientId });
              if (!created) throw error;
              socket.emit('message:ack', {
                conversationId: rawConv,
                messageId: String(created._id),
                serverMessageId: String(created._id),
                clientId,
                createdAt: created.createdAt,
                receivedAt: new Date().toISOString(),
              });
              return;
            }
            throw error;
          }
        } else {
          created = await MessageModel.create({
            conversationId: dbConversationId,
            senderId,
            content: {
              text,
              mediaUrl: mediaUrl || undefined,
              mediaType: mediaUrl ? mediaType : 'text',
              metadata: metadataForDb
            },
            type: 'message',
            replyTo,
            expiresAt
          });
        }

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

        const playableMediaUrl = mediaUrl ? await resolveStoredMediaUrl(mediaUrl) : '';
        const serverPayload = {
          conversationId: rawConv,
          messageId: String(created._id),
          senderId,
          content: text,
          media: mediaUrl
            ? {
                uri: playableMediaUrl,
                type: mediaType,
                durationSec: metadata.durationSec,
                name: metadata.name,
                size: metadata.size
              }
            : undefined,
          createdAt: created.createdAt.toISOString(),
          expiresAt: created.expiresAt?.toISOString(),
          replyTo: created.replyTo
            ? {
                messageId: String(created.replyTo.messageId),
                senderId: String(created.replyTo.senderId),
                previewText: created.replyTo.previewText,
                mediaType: created.replyTo.mediaType
              }
            : undefined,
          clientId: payload.clientId,
          senderPreview,
          conversationType: convMeta?.type,
          conversationTitle: convMeta?.title
        };

        socket.emit('message:ack', {
          conversationId: rawConv,
          messageId: String(created._id),
          serverMessageId: String(created._id),
          clientId: payload.clientId,
          createdAt: created.createdAt,
          receivedAt: now.toISOString(),
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
          try {
            await MessageModel.updateOne(
              { _id: created._id },
              { $set: { deliveredAt: new Date() } }
            );
          } catch {
            /* best-effort */
          }
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

        // Always target registered devices. Foreground clients suppress local tray duplicates.
        const pushRecipients = [...recipientIds].filter((pid) => pid !== senderId);
        if (pushRecipients.length > 0) {
          const senderName = senderPreview.name || senderPreview.username || 'New message';
          for (const recipientId of pushRecipients) {
            void enqueueNotification({
              eventId: `message:${String(created._id)}:${recipientId}`,
              userId: recipientId,
              kind: 'message',
              correlationId: String(created._id),
              payload: {
                senderName,
                preview: previewText,
                chatId: rawConv,
                messageId: String(created._id)
              }
            });
          }
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
        if (!conv || !Array.isArray(conv.participants) || conv.participants.length < 2) {
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

    socket.on(
      'call:initiate',
      async (payload: { to: string; callerName?: string; isVideo?: boolean; offer?: unknown }) => {
      try {
        const callerId = socket.data.userId as string;
        const receiverId = typeof payload.to === 'string' ? payload.to.trim() : '';
        if (!receiverId || !Types.ObjectId.isValid(receiverId)) {
          socket.emit('call:rejected', { reason: 'invalid_target' });
          return;
        }
        if (receiverId === callerId) {
          socket.emit('call:rejected', { reason: 'invalid_target' });
          return;
        }
        if (!(await areFriends(callerId, receiverId))) {
          socket.emit('call:rejected', { reason: 'not_friends' });
          return;
        }

        // LiveKit media path: SDP offer is optional (legacy P2P clients may still send it).
        let isVideo = Boolean(payload.isVideo);
        if (payload.offer && typeof payload.offer === 'object') {
          const offerSdp =
            typeof (payload.offer as { sdp?: unknown }).sdp === 'string'
              ? (payload.offer as { sdp: string }).sdp
              : '';
          if (offerSdp.includes('m=video')) isVideo = true;
        }

        const existing = await getPendingCall(receiverId);
        if (existing) {
          socket.emit('call:busy', { callId: existing.callId });
          return;
        }

        const receiverActive = await getActiveCall(receiverId);
        if (receiverActive) {
          socket.emit('call:busy', { callId: receiverActive.callId });
          return;
        }

        const callerActive = await getActiveCall(callerId);
        if (callerActive) {
          socket.emit('call:busy', { callId: callerActive.callId });
          return;
        }

        const { record: pending, stored } = await storePendingCall(receiverId, {
          callerId,
          callerName: payload.callerName ?? 'Unknown',
          isVideo,
          ...(payload.offer !== undefined ? { offer: payload.offer } : {}),
        });

        const socketsInRoom = io.sockets.adapter.rooms.get(`user:${receiverId}`)?.size ?? 0;

        if (!stored && socketsInRoom === 0) {
          socket.emit('call:failed', { reason: 'storage_unavailable' });
          return;
        }

        if (!stored && socketsInRoom > 0) {
          console.warn('[call:initiate] Redis store failed; callee is online via socket', receiverId);
        }

        console.log('[call:initiate]', {
          callerId,
          receiverId,
          callId: pending.callId,
          room: `user:${receiverId}`,
          socketsInRoom,
          media: 'livekit',
          isVideo,
        });

        io.to(`user:${receiverId}`).emit('call:invitation', {
          callId: pending.callId,
          fromId: callerId,
          fromName: payload.callerName ?? 'Unknown',
          isVideo,
          media: 'livekit',
          ...(payload.offer !== undefined ? { offer: payload.offer } : {}),
        });

        socket.emit('call:ringing', { callId: pending.callId, receiverId, media: 'livekit' });

        // Always wake Android (data-only FCM) + iOS Expo via outbox retries.
        // LiveKit JWTs are never included in push payloads.
        void enqueueNotification({
          eventId: `call:${pending.callId}:${receiverId}`,
          userId: receiverId,
          kind: 'call',
          correlationId: pending.callId,
          payload: {
            callId: pending.callId,
            callerId,
            callerName: payload.callerName ?? 'Unknown',
            isVideo,
          },
        });
      } catch (error) {
        console.error('[call:initiate] failed', error);
        socket.emit('call:failed', { reason: 'internal' });
      }
    });

    socket.on('call:accept', async (payload: { to: string; callId?: string; answer?: unknown }) => {
      try {
        const accepterId = socket.data.userId as string;
        const callerId = typeof payload.to === 'string' ? payload.to.trim() : '';
        if (!callerId) {
          socket.emit('call:error', { code: 'invalid_target' });
          return;
        }

        const pending = await getPendingCall(accepterId);
        if (!pending || pending.callerId !== callerId) {
          socket.emit('call:error', { code: 'no_pending_call' });
          return;
        }
        if (payload.callId && payload.callId !== pending.callId) {
          socket.emit('call:error', { code: 'call_id_mismatch' });
          return;
        }

        await clearPendingCall(accepterId);
        await setActiveCall(accepterId, pending.callId, callerId);
        await setActiveCall(callerId, pending.callId, accepterId);
        io.to(`user:${callerId}`).emit('call:accepted', {
          callId: pending.callId,
          media: 'livekit',
          ...(payload.answer !== undefined ? { answer: payload.answer } : {}),
        });
      } catch (error) {
        console.error('[call:accept] failed', error);
        socket.emit('call:error', { code: 'internal' });
      }
    });

    // Legacy P2P ICE/renegotiate — no-ops while LiveKit owns the media plane.
    // Kept so older clients do not crash the socket handler; signals are dropped.
    socket.on('ice-candidate', () => {});
    socket.on('call:renegotiate', () => {});

    socket.on('call:end', async (payload: { to: string; reason?: string; callId?: string }) => {
      const me = socket.data.userId as string;
      const other = typeof payload.to === 'string' ? payload.to.trim() : '';
      const requestedCallId = typeof payload.callId === 'string' ? payload.callId : undefined;
      const [active, pendingAsCallee, pendingAsCaller] = await Promise.all([
        getActiveCall(me),
        getPendingCall(me),
        other ? getPendingCall(other) : Promise.resolve(null),
      ]);

      const authorization = authorizeCallEnd({
        me,
        other: other || undefined,
        requestedCallId,
        active,
        pendingAsCallee,
        pendingAsCaller,
      });
      if (!authorization.ok) {
        socket.emit('call:error', { code: authorization.code });
        return;
      }
      const callId = authorization.callId;

      await clearPendingCall(me);
      if (other) await clearPendingCall(other);
      if (other) await clearActiveCallPair(me, other);
      else await clearActiveCall(me);

      if (other) {
        io.to(`user:${other}`).emit('call:ended', {
          reason: payload.reason ?? 'ended',
          callId,
        });
        if (callId) {
          void enqueueNotification({
            eventId: `call_cancel:${callId}:${other}`,
            userId: other,
            kind: 'call_cancel',
            correlationId: callId,
            payload: { callId }
          });
        }
      }
      if (callId) {
        void enqueueNotification({
          eventId: `call_cancel:${callId}:${me}`,
          userId: me,
          kind: 'call_cancel',
          correlationId: callId,
          payload: { callId }
        });
      }
    });
  });

  return io;
}
