import { ConversationModel } from '../modules/messages/conversation.model';

/** Stable virtual id used by mobile for DMs (sorted user pair). */
export function dmVirtualId(userIdA: string, userIdB: string): string {
  const sorted = [String(userIdA), String(userIdB)].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

/** Resolve client conversation id to Mongo id. Does not create missing DMs. */
export async function resolveVirtualConversationId(input: string): Promise<string> {
  if (!input.startsWith('dm:')) return input;
  const parts = input.split(':');
  if (parts.length !== 3) return input;
  const u1 = parts[1];
  const u2 = parts[2];

  const existing = await ConversationModel.findOne({
    type: 'dm',
    'participants.userId': { $all: [u1, u2] }
  })
    .sort({ lastActivityAt: -1, _id: -1 })
    .select('_id')
    .lean();

  if (existing) return String(existing._id);
  return input;
}
