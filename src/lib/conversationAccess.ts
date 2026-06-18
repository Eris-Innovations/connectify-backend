import { ConversationModel } from '../modules/messages/conversation.model';
import { resolveVirtualConversationId } from './conversationIds';

/** Parsed `dm:userA:userB` pair (order as in the id string). */
export function parseDmVirtualUserPair(raw: string): { a: string; b: string } | null {
  if (!raw.startsWith('dm:')) return null;
  const parts = raw.split(':');
  if (parts.length !== 3) return null;
  const a = parts[1]?.trim() ?? '';
  const b = parts[2]?.trim() ?? '';
  if (!a || !b) return null;
  return { a, b };
}

/**
 * Resolves a client conversation id to the MongoDB id only if `userId` is a participant.
 * For virtual DM ids (`dm:a:b`), refuses resolution unless `userId` is `a` or `b`, so a third
 * party cannot trigger creation of a DM between two other users.
 */
export async function resolveConversationForMember(
  userId: string,
  rawConversationId: string
): Promise<string | null> {
  const raw = typeof rawConversationId === 'string' ? rawConversationId.trim() : '';
  if (!raw) return null;

  const pair = parseDmVirtualUserPair(raw);
  if (pair && pair.a !== userId && pair.b !== userId) {
    return null;
  }

  const dbId = await resolveVirtualConversationId(raw);
  const conv = await ConversationModel.findById(dbId).select('participants').lean();
  if (!conv?.participants?.length) return null;
  return conv.participants.some((p) => String(p.userId) === userId) ? dbId : null;
}
