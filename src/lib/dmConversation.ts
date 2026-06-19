import { ConversationModel } from '../modules/messages/conversation.model';
import { MessageModel } from '../modules/messages/message.model';
import { Types } from 'mongoose';

/** Sorted user id pair for stable lookups. */
export function sortUserPair(userIdA: string, userIdB: string): [string, string] {
  const a = String(userIdA);
  const b = String(userIdB);
  return a < b ? [a, b] : [b, a];
}

export async function findDmMongoId(userIdA: string, userIdB: string): Promise<string | null> {
  const existing = await ConversationModel.findOne({
    type: 'dm',
    'participants.userId': { $all: [userIdA, userIdB] }
  })
    .sort({ lastActivityAt: -1, _id: -1 })
    .select('_id')
    .lean();

  return existing ? String(existing._id) : null;
}

export async function ensureDmConversation(
  userIdA: string,
  userIdB: string,
  createdBy: string
): Promise<string> {
  const existingId = await findDmMongoId(userIdA, userIdB);
  if (existingId) return existingId;

  const created = await ConversationModel.create({
    type: 'dm',
    participants: [
      { userId: userIdA, role: 'member' },
      { userId: userIdB, role: 'member' }
    ],
    createdBy,
    lastActivityAt: new Date()
  });
  return String(created._id);
}

/** Delete DM conversation and all messages between two users. */
export async function purgeDmBetweenUsers(userIdA: string, userIdB: string): Promise<void> {
  const conversations = await ConversationModel.find({
    type: 'dm',
    'participants.userId': { $all: [userIdA, userIdB] }
  })
    .select('_id')
    .lean();

  if (!conversations.length) return;

  const ids = conversations.map((c) => c._id);
  await MessageModel.deleteMany({ conversationId: { $in: ids } });
  await ConversationModel.deleteMany({ _id: { $in: ids } });
}

export function peerUserIdFromDmChatId(chatId: string, currentUserId: string): string | null {
  if (!chatId.startsWith('dm:')) return null;
  const parts = chatId.split(':');
  if (parts.length !== 3) return null;
  const a = parts[1];
  const b = parts[2];
  if (a === currentUserId) return b;
  if (b === currentUserId) return a;
  return null;
}

export async function getDmPeerUserId(mongoConvId: string, currentUserId: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(mongoConvId)) return null;
  const conv = await ConversationModel.findById(mongoConvId).select('type participants').lean();
  if (!conv || conv.type !== 'dm') return null;
  const participantIds = (conv.participants ?? []).map((p) => String(p.userId));
  return participantIds.find((id) => id !== currentUserId) ?? null;
}
