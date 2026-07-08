import { Types } from 'mongoose';
import { TranscriptModel } from '../ai/transcript.model';
import { MessageModel } from '../messages/message.model';
import { ConversationModel } from '../messages/conversation.model';
import { CallModel } from '../calls/call.model';
import { UserModel } from '../users/user.model';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { escapeMongoRegex } from '../../lib/mongoRegex';

export type MemberActivityDirection = 'sent' | 'received' | 'outgoing' | 'incoming';

export type AdminMemberActivityItem = {
  id: string;
  itemType: 'voice_message' | 'call';
  kind: 'voice_message' | 'call';
  direction: MemberActivityDirection;
  subjectUserId: string;
  userId: string | null;
  userName: string | null;
  username: string | null;
  email: string | null;
  counterpartyUserId: string | null;
  counterpartyName: string | null;
  counterpartyUsername: string | null;
  source: string;
  language: string;
  rawText: string;
  hasTranscript: boolean;
  mediaUrl: string | null;
  messageId: string | null;
  callSessionId: string | null;
  conversationId: string | null;
  whisperModel: string | null;
  durationSec: number | null;
  isVideo: boolean | null;
  callType: string | null;
  createdAt: Date;
};

export type MemberActivityFilters = {
  userIds: string[];
  kind?: string;
  source?: string;
  q?: string;
  direction?: string;
  limit: number;
};

function peerFromConversation(
  conversation: { participants?: { userId: Types.ObjectId }[]; type?: string } | null,
  subjectUserId: string,
  fallbackSenderId: string
): string | null {
  if (!conversation?.participants?.length) return fallbackSenderId;
  if (conversation.type === 'dm') {
    const peer = conversation.participants.find((p) => String(p.userId) !== subjectUserId);
    return peer ? String(peer.userId) : fallbackSenderId;
  }
  return fallbackSenderId;
}

function matchesDirection(
  direction: MemberActivityDirection,
  filter: string | undefined
): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'sent') return direction === 'sent' || direction === 'outgoing';
  if (filter === 'received') return direction === 'received' || direction === 'incoming';
  return direction === filter;
}

function matchesKind(kind: string, filter: string | undefined): boolean {
  if (!filter || filter === 'all') return true;
  return kind === filter;
}

function matchesSource(hasTranscript: boolean, source: string, filter: string | undefined): boolean {
  if (!filter || filter === 'all') return true;
  if (!hasTranscript) return false;
  return source === filter;
}

function matchesText(rawText: string, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  return rawText.toLowerCase().includes(q.trim().toLowerCase());
}

export async function getMemberVoiceActivity(
  filters: MemberActivityFilters
): Promise<{ items: AdminMemberActivityItem[]; total: number }> {
  const limit = filters.limit;
  const subjectOids = filters.userIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (subjectOids.length === 0) {
    return { items: [], total: 0 };
  }

  const subjectIdSet = new Set(subjectOids.map((id) => String(id)));

  const conversations = await ConversationModel.find({
    'participants.userId': { $in: subjectOids }
  })
    .select('_id type participants')
    .lean();

  const conversationIds = conversations.map((c) => c._id);
  const conversationById = new Map(conversations.map((c) => [String(c._id), c]));

  const [sentVoice, receivedVoice, calls] = await Promise.all([
    MessageModel.find({
      senderId: { $in: subjectOids },
      'content.mediaType': 'voice'
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
    conversationIds.length > 0
      ? MessageModel.find({
          conversationId: { $in: conversationIds },
          senderId: { $nin: subjectOids },
          'content.mediaType': 'voice'
        })
          .sort({ createdAt: -1 })
          .limit(500)
          .lean()
      : Promise.resolve([]),
    CallModel.find({
      $or: [{ callerId: { $in: subjectOids } }, { receiverId: { $in: subjectOids } }]
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
  ]);

  const messageIds = [...sentVoice, ...receivedVoice].map((m) => m._id);
  const callIds = calls.map((c) => c._id);

  const orClauses: Record<string, unknown>[] = [];
  if (messageIds.length) orClauses.push({ messageId: { $in: messageIds } });
  if (callIds.length) orClauses.push({ callSessionId: { $in: callIds } });
  const transcripts =
    orClauses.length > 0 ? await TranscriptModel.find({ $or: orClauses }).lean() : [];

  const transcriptByMessageId = new Map(
    transcripts.filter((t) => t.messageId).map((t) => [String(t.messageId), t])
  );
  const transcriptByCallId = new Map(
    transcripts.filter((t) => t.callSessionId).map((t) => [String(t.callSessionId), t])
  );

  const userIdCollector = new Set<string>();
  for (const oid of subjectOids) userIdCollector.add(String(oid));
  for (const m of [...sentVoice, ...receivedVoice]) userIdCollector.add(String(m.senderId));
  for (const c of calls) {
    userIdCollector.add(String(c.callerId));
    userIdCollector.add(String(c.receiverId));
  }
  for (const t of transcripts) {
    if (t.userId) userIdCollector.add(String(t.userId));
  }

  const users = await UserModel.find({ _id: { $in: [...userIdCollector].map((id) => new Types.ObjectId(id)) } })
    .select('name username email')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const items: AdminMemberActivityItem[] = [];

  const userBrief = (id: string | null | undefined) => {
    if (!id) return { userId: null, userName: null, username: null, email: null };
    const u = userMap.get(id);
    return {
      userId: id,
      userName: u?.name ?? null,
      username: u?.username ?? null,
      email: u?.email ?? null
    };
  };

  for (const message of sentVoice) {
    const subjectUserId = String(message.senderId);
    if (!subjectIdSet.has(subjectUserId)) continue;

    const conv = conversationById.get(String(message.conversationId));
    const counterpartyId = peerFromConversation(conv ?? null, subjectUserId, subjectUserId);
    const transcript = transcriptByMessageId.get(String(message._id));
    const cp = userBrief(counterpartyId);

    items.push({
      id: transcript ? String(transcript._id) : `voice:${String(message._id)}`,
      itemType: 'voice_message',
      kind: 'voice_message',
      direction: 'sent',
      subjectUserId,
      ...userBrief(subjectUserId),
      counterpartyUserId: cp.userId,
      counterpartyName: cp.userName,
      counterpartyUsername: cp.username,
      source: transcript?.source ?? '',
      language: transcript?.language ?? 'auto',
      rawText: transcript?.rawText ?? '',
      hasTranscript: Boolean(transcript?.rawText?.trim()),
      mediaUrl: message.content?.mediaUrl ? await resolveStoredMediaUrl(message.content.mediaUrl) : null,
      messageId: String(message._id),
      callSessionId: null,
      conversationId: String(message.conversationId),
      whisperModel: transcript?.whisperModel ?? null,
      durationSec:
        typeof message.content?.metadata?.durationSec === 'number'
          ? message.content.metadata.durationSec
          : null,
      isVideo: null,
      callType: null,
      createdAt: message.createdAt
    });
  }

  for (const message of receivedVoice) {
    const conv = conversationById.get(String(message.conversationId));
    const subjectParticipant = conv?.participants?.find((p) => subjectIdSet.has(String(p.userId)));
    if (!subjectParticipant) continue;

    const subjectUserId = String(subjectParticipant.userId);
    const senderId = String(message.senderId);
    const transcript = transcriptByMessageId.get(String(message._id));
    const cp = userBrief(senderId);

    items.push({
      id: transcript ? String(transcript._id) : `voice:${String(message._id)}`,
      itemType: 'voice_message',
      kind: 'voice_message',
      direction: 'received',
      subjectUserId,
      ...userBrief(senderId),
      counterpartyUserId: cp.userId,
      counterpartyName: cp.userName,
      counterpartyUsername: cp.username,
      source: transcript?.source ?? '',
      language: transcript?.language ?? 'auto',
      rawText: transcript?.rawText ?? '',
      hasTranscript: Boolean(transcript?.rawText?.trim()),
      mediaUrl: message.content?.mediaUrl ? await resolveStoredMediaUrl(message.content.mediaUrl) : null,
      messageId: String(message._id),
      callSessionId: null,
      conversationId: String(message.conversationId),
      whisperModel: transcript?.whisperModel ?? null,
      durationSec:
        typeof message.content?.metadata?.durationSec === 'number'
          ? message.content.metadata.durationSec
          : null,
      isVideo: null,
      callType: null,
      createdAt: message.createdAt
    });
  }

  for (const call of calls) {
    const callerId = String(call.callerId);
    const receiverId = String(call.receiverId);
    const subjectUserId = subjectIdSet.has(callerId) ? callerId : subjectIdSet.has(receiverId) ? receiverId : null;
    if (!subjectUserId) continue;

    const direction: MemberActivityDirection = subjectUserId === callerId ? 'outgoing' : 'incoming';
    const counterpartyId = subjectUserId === callerId ? receiverId : callerId;
    const transcript = transcriptByCallId.get(String(call._id));
    const cp = userBrief(counterpartyId);
    const recordingUrl = call.recordingUrl?.trim() || transcript?.mediaUrl || '';

    items.push({
      id: transcript ? String(transcript._id) : `call:${String(call._id)}`,
      itemType: 'call',
      kind: 'call',
      direction,
      subjectUserId,
      ...userBrief(subjectUserId),
      counterpartyUserId: cp.userId,
      counterpartyName: cp.userName,
      counterpartyUsername: cp.username,
      source: transcript?.source ?? '',
      language: transcript?.language ?? 'auto',
      rawText: transcript?.rawText ?? '',
      hasTranscript: Boolean(transcript?.rawText?.trim()),
      mediaUrl: recordingUrl ? await resolveStoredMediaUrl(recordingUrl) : null,
      messageId: null,
      callSessionId: String(call._id),
      conversationId: null,
      whisperModel: transcript?.whisperModel ?? null,
      durationSec: typeof call.duration === 'number' ? call.duration : null,
      isVideo: Boolean(call.isVideo),
      callType: call.type,
      createdAt: call.createdAt
    });
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const filtered = items.filter((item) => {
    if (!matchesKind(item.kind, filters.kind)) return false;
    if (!matchesDirection(item.direction, filters.direction)) return false;
    if (!matchesSource(item.hasTranscript, item.source, filters.source)) return false;
    if (!matchesText(item.rawText, filters.q)) return false;
    return true;
  });

  return {
    total: filtered.length,
    items: filtered.slice(0, limit)
  };
}

/**
 * Recent voice-note and call activity across ALL users (no member filter).
 * Used by the Whisper panel default view so admins always see real user data,
 * not just rows that already have an AI transcript document.
 */
export async function getRecentVoiceActivity(filters: {
  kind?: string;
  source?: string;
  q?: string;
  direction?: string;
  limit: number;
}): Promise<{ items: AdminMemberActivityItem[]; total: number }> {
  const scanLimit = 500;

  const [voiceMessages, calls] = await Promise.all([
    MessageModel.find({ 'content.mediaType': 'voice' })
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .lean(),
    CallModel.find({})
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .lean()
  ]);

  const messageIds = voiceMessages.map((m) => m._id);
  const callIds = calls.map((c) => c._id);

  const orClauses: Record<string, unknown>[] = [];
  if (messageIds.length) orClauses.push({ messageId: { $in: messageIds } });
  if (callIds.length) orClauses.push({ callSessionId: { $in: callIds } });
  const transcripts = orClauses.length > 0 ? await TranscriptModel.find({ $or: orClauses }).lean() : [];

  const transcriptByMessageId = new Map(
    transcripts.filter((t) => t.messageId).map((t) => [String(t.messageId), t])
  );
  const transcriptByCallId = new Map(
    transcripts.filter((t) => t.callSessionId).map((t) => [String(t.callSessionId), t])
  );

  const userIdCollector = new Set<string>();
  for (const m of voiceMessages) userIdCollector.add(String(m.senderId));
  for (const c of calls) {
    userIdCollector.add(String(c.callerId));
    userIdCollector.add(String(c.receiverId));
  }

  const users =
    userIdCollector.size > 0
      ? await UserModel.find({ _id: { $in: [...userIdCollector].map((id) => new Types.ObjectId(id)) } })
          .select('name username email')
          .lean()
      : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const userBrief = (id: string | null | undefined) => {
    if (!id) return { userId: null, userName: null, username: null, email: null };
    const u = userMap.get(id);
    return {
      userId: id,
      userName: u?.name ?? null,
      username: u?.username ?? null,
      email: u?.email ?? null
    };
  };

  const items: AdminMemberActivityItem[] = [];

  for (const message of voiceMessages) {
    const subjectUserId = String(message.senderId);
    const transcript = transcriptByMessageId.get(String(message._id));
    items.push({
      id: transcript ? String(transcript._id) : `voice:${String(message._id)}`,
      itemType: 'voice_message',
      kind: 'voice_message',
      direction: 'sent',
      subjectUserId,
      ...userBrief(subjectUserId),
      counterpartyUserId: null,
      counterpartyName: null,
      counterpartyUsername: null,
      source: transcript?.source ?? '',
      language: transcript?.language ?? 'auto',
      rawText: transcript?.rawText ?? '',
      hasTranscript: Boolean(transcript?.rawText?.trim()),
      mediaUrl: message.content?.mediaUrl ? await resolveStoredMediaUrl(message.content.mediaUrl) : null,
      messageId: String(message._id),
      callSessionId: null,
      conversationId: message.conversationId ? String(message.conversationId) : null,
      whisperModel: transcript?.whisperModel ?? null,
      durationSec:
        typeof message.content?.metadata?.durationSec === 'number' ? message.content.metadata.durationSec : null,
      isVideo: null,
      callType: null,
      createdAt: message.createdAt
    });
  }

  for (const call of calls) {
    const callerId = String(call.callerId);
    const transcript = transcriptByCallId.get(String(call._id));
    const cp = userBrief(String(call.receiverId));
    const recordingUrl = call.recordingUrl?.trim() || transcript?.mediaUrl || '';
    items.push({
      id: transcript ? String(transcript._id) : `call:${String(call._id)}`,
      itemType: 'call',
      kind: 'call',
      direction: 'outgoing',
      subjectUserId: callerId,
      ...userBrief(callerId),
      counterpartyUserId: cp.userId,
      counterpartyName: cp.userName,
      counterpartyUsername: cp.username,
      source: transcript?.source ?? '',
      language: transcript?.language ?? 'auto',
      rawText: transcript?.rawText ?? '',
      hasTranscript: Boolean(transcript?.rawText?.trim()),
      mediaUrl: recordingUrl ? await resolveStoredMediaUrl(recordingUrl) : null,
      messageId: null,
      callSessionId: String(call._id),
      conversationId: null,
      whisperModel: transcript?.whisperModel ?? null,
      durationSec: typeof call.duration === 'number' ? call.duration : null,
      isVideo: Boolean(call.isVideo),
      callType: call.type,
      createdAt: call.createdAt
    });
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const filtered = items.filter((item) => {
    if (!matchesKind(item.kind, filters.kind)) return false;
    if (!matchesDirection(item.direction, filters.direction)) return false;
    if (!matchesSource(item.hasTranscript, item.source, filters.source)) return false;
    if (!matchesText(item.rawText, filters.q)) return false;
    return true;
  });

  return {
    total: filtered.length,
    items: filtered.slice(0, filters.limit)
  };
}

export function mapActivityItemToApiRow(item: AdminMemberActivityItem) {
  return {
    id: item.id,
    itemType: item.itemType,
    kind: item.kind,
    direction: item.direction,
    subjectUserId: item.subjectUserId,
    userId: item.userId,
    userName: item.userName,
    username: item.username,
    email: item.email,
    counterpartyUserId: item.counterpartyUserId,
    counterpartyName: item.counterpartyName,
    counterpartyUsername: item.counterpartyUsername,
    source: item.source,
    language: item.language,
    rawText: item.rawText,
    hasTranscript: item.hasTranscript,
    mediaUrl: item.mediaUrl,
    messageId: item.messageId,
    callSessionId: item.callSessionId,
    conversationId: item.conversationId,
    whisperModel: item.whisperModel,
    durationSec: item.durationSec,
    isVideo: item.isVideo,
    callType: item.callType,
    createdAt: item.createdAt
  };
}

/** Resolve member search string to user ids (exact id, or name/username/email match). */
export async function resolveMemberUserIds(member: string, userId: string): Promise<string[]> {
  if (userId && Types.ObjectId.isValid(userId)) {
    return [userId];
  }
  if (!member.trim()) return [];

  if (Types.ObjectId.isValid(member.trim())) {
    return [member.trim()];
  }

  const literal = escapeMongoRegex(member.trim());
  const matchedUsers = await UserModel.find({
    role: 'user',
    $or: [
      { name: { $regex: literal, $options: 'i' } },
      { username: { $regex: literal, $options: 'i' } },
      { email: { $regex: literal, $options: 'i' } }
    ]
  })
    .select('_id')
    .limit(50)
    .lean();

  return matchedUsers.map((u) => String(u._id));
}
