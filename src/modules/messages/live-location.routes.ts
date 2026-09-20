import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { resolveConversationForMember } from '../../lib/conversationAccess';
import { dmVirtualId } from '../../lib/conversationIds';
import { ConversationModel } from '../messages/conversation.model';
import { MessageModel } from '../messages/message.model';
import { LiveLocationSessionModel } from './live-location.model';
import {
  isAllowedLiveLocationDuration,
  isValidLatLng,
  parseLocationCoord,
} from './live-location.shared';
import { emitToUser } from '../../sockets/io';

export const liveLocationRouter = Router();

function parseCoord(value: unknown): number | null {
  return parseLocationCoord(value);
}

async function clientConversationIds(
  mongoConversationId: string,
  participantIds: string[]
): Promise<Map<string, string>> {
  const conv = await ConversationModel.findById(mongoConversationId).select('type').lean();
  const byUser = new Map<string, string>();
  if (conv?.type === 'dm' && participantIds.length >= 2) {
    for (const pid of participantIds) {
      const peer = participantIds.find((id) => id !== pid) ?? pid;
      byUser.set(pid, dmVirtualId(pid, peer));
    }
  } else {
    for (const pid of participantIds) {
      byUser.set(pid, mongoConversationId);
    }
  }
  return byUser;
}

async function participantIdsForConversation(mongoConversationId: string): Promise<string[]> {
  const conv = await ConversationModel.findById(mongoConversationId).select('participants').lean();
  return (conv?.participants ?? []).map((p: { userId: Types.ObjectId }) => String(p.userId));
}

/** Start a live location session and seed a location message in the chat. */
liveLocationRouter.post('/live-location/start', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const rawConversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  const durationSec = Number(req.body?.durationSec ?? 0);
  const lat = parseCoord(req.body?.lat);
  const lng = parseCoord(req.body?.lng);
  const accuracy = parseCoord(req.body?.accuracy);
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 120) : '';

  if (!rawConversationId || lat == null || lng == null || !isValidLatLng(lat, lng)) {
    return res.status(400).json({ success: false, message: 'Invalid location payload' });
  }
  if (!isAllowedLiveLocationDuration(durationSec)) {
    return res.status(400).json({ success: false, message: 'durationSec must be 900, 3600, or 28800' });
  }

  const conversationId = await resolveConversationForMember(userId, rawConversationId);
  if (!conversationId) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationSec * 1000);

  await LiveLocationSessionModel.updateMany(
    { conversationId, userId, stoppedAt: null },
    { $set: { stoppedAt: now } }
  );

  const session = await LiveLocationSessionModel.create({
    conversationId,
    userId,
    lat,
    lng,
    accuracy,
    label,
    expiresAt,
    lastUpdatedAt: now
  });

  const message = await MessageModel.create({
    conversationId,
    senderId: userId,
    content: {
      text: label || '📍 Live location',
      mediaType: 'location',
      metadata: {
        lat,
        lng,
        label,
        accuracy: accuracy ?? undefined,
        live: true,
        liveSessionId: String(session._id),
        expiresAt: expiresAt.toISOString()
      }
    },
    type: 'message'
  });

  session.messageId = message._id;
  await session.save();

  await ConversationModel.findByIdAndUpdate(conversationId, {
    lastActivityAt: now,
    lastMessage: {
      messageId: message._id,
      senderId: userId,
      previewText: '📍 Live location',
      createdAt: message.createdAt
    },
    $unset: { 'participants.$[].deletedAt': '' }
  }).exec();

  const participants = await participantIdsForConversation(conversationId);
  const conversationIdsByUser = await clientConversationIds(conversationId, participants);
  const locationMeta = {
    lat,
    lng,
    label,
    accuracy: accuracy ?? undefined,
    live: true,
    liveSessionId: String(session._id),
    expiresAt: expiresAt.toISOString()
  };

  for (const pid of participants) {
    const clientConversationId = conversationIdsByUser.get(pid) ?? rawConversationId;
    emitToUser(pid, 'message:new', {
      conversationId: clientConversationId,
      messageId: String(message._id),
      senderId: userId,
      content: message.content?.text ?? '📍 Live location',
      location: locationMeta,
      createdAt: message.createdAt.toISOString()
    });
    emitToUser(pid, 'live-location:update', {
      sessionId: String(session._id),
      conversationId: clientConversationId,
      messageId: String(message._id),
      userId,
      lat,
      lng,
      accuracy,
      expiresAt: expiresAt.toISOString(),
      stopped: false
    });
    emitToUser(pid, 'chats:resync', {});
  }

  return res.json({
    success: true,
    data: {
      sessionId: String(session._id),
      messageId: String(message._id),
      expiresAt: expiresAt.toISOString(),
      lat,
      lng
    }
  });
});

liveLocationRouter.post('/live-location/:id/update', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const lat = parseCoord(req.body?.lat);
  const lng = parseCoord(req.body?.lng);
  const accuracy = parseCoord(req.body?.accuracy);

  if (!sessionId || !Types.ObjectId.isValid(sessionId) || lat == null || lng == null) {
    return res.status(400).json({ success: false, message: 'Invalid update' });
  }

  const session = await LiveLocationSessionModel.findById(sessionId);
  if (!session || String(session.userId) !== userId) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }
  if (session.stoppedAt || session.expiresAt.getTime() <= Date.now()) {
    return res.status(410).json({ success: false, message: 'Session ended' });
  }

  session.lat = lat;
  session.lng = lng;
  if (accuracy != null) session.accuracy = accuracy;
  session.lastUpdatedAt = new Date();
  await session.save();

  if (session.messageId) {
    await MessageModel.findByIdAndUpdate(session.messageId, {
      $set: {
        'content.metadata.lat': lat,
        'content.metadata.lng': lng,
        'content.metadata.accuracy': accuracy ?? undefined,
        'content.metadata.live': true
      }
    }).exec();
  }

  const conversationId = String(session.conversationId);
  const participants = await participantIdsForConversation(conversationId);
  const conversationIdsByUser = await clientConversationIds(conversationId, participants);

  for (const pid of participants) {
    emitToUser(pid, 'live-location:update', {
      sessionId: String(session._id),
      conversationId: conversationIdsByUser.get(pid) ?? conversationId,
      messageId: session.messageId ? String(session.messageId) : undefined,
      userId,
      lat,
      lng,
      accuracy,
      expiresAt: session.expiresAt.toISOString(),
      stopped: false
    });
  }

  return res.json({ success: true });
});

liveLocationRouter.post('/live-location/:id/stop', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ success: false, message: 'Invalid session' });
  }

  const session = await LiveLocationSessionModel.findById(sessionId);
  if (!session || String(session.userId) !== userId) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  const now = new Date();
  session.stoppedAt = now;
  await session.save();

  if (session.messageId) {
    await MessageModel.findByIdAndUpdate(session.messageId, {
      $set: {
        'content.metadata.live': false,
        'content.metadata.stoppedAt': now.toISOString()
      }
    }).exec();
  }

  const conversationId = String(session.conversationId);
  const participants = await participantIdsForConversation(conversationId);
  const conversationIdsByUser = await clientConversationIds(conversationId, participants);

  for (const pid of participants) {
    emitToUser(pid, 'live-location:update', {
      sessionId: String(session._id),
      conversationId: conversationIdsByUser.get(pid) ?? conversationId,
      messageId: session.messageId ? String(session.messageId) : undefined,
      userId,
      lat: session.lat,
      lng: session.lng,
      expiresAt: session.expiresAt.toISOString(),
      stopped: true
    });
  }

  return res.json({ success: true });
});
