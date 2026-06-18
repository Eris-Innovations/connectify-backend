import { ConversationModel } from '../modules/messages/conversation.model';

/** Stable virtual id used by mobile for DMs (sorted user pair). */
export function dmVirtualId(userIdA: string, userIdB: string): string {
  const sorted = [String(userIdA), String(userIdB)].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

/** Resolve mobile virtual `dm:a:b` to Mongo conversation id (create DM if missing). */
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
    .exec();

  if (existing) return String(existing._id);

  const created = await ConversationModel.create({
    type: 'dm',
    participants: [
      { userId: u1, role: 'member' },
      { userId: u2, role: 'member' }
    ],
    createdBy: u1,
    lastActivityAt: new Date()
  });
  return String(created._id);
}
