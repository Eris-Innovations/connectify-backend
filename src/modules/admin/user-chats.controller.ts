import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { ConversationModel } from '../messages/conversation.model';
import { MessageModel } from '../messages/message.model';
import { resolveVirtualConversationId } from '../../lib/conversationIds';

function stripEnc(s: string): string {
  return typeof s === 'string' && s.startsWith('ENC:') ? s.slice(4) : s;
}

function singleParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return null;
}

type PopulatedUser = { _id: Types.ObjectId; name?: string; username?: string; email?: string };

function participantUserIdString(p: { userId: PopulatedUser | Types.ObjectId | unknown }): string {
  const u = p.userId;
  if (u && typeof u === 'object' && '_id' in (u as object)) {
    return String((u as PopulatedUser)._id);
  }
  return String(u);
}

/** GET /admin/users/:userId/chats */
export async function adminUserChatsList(req: Request, res: Response): Promise<void> {
  const rawId = req.params.userId;
  const userId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(400).json({ success: false, message: 'Invalid user id' });
    return;
  }

  const user = await UserModel.findById(userId).select('name username email').lean();
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const uid = new Types.ObjectId(userId);
  const convs = await ConversationModel.find({
    'participants.userId': uid,
    isArchived: { $ne: true }
  })
    .sort({ lastActivityAt: -1 })
    .limit(80)
    .populate('participants.userId', 'name username email')
    .lean();

  const rows = convs.map((c: any) => {
    const parts = (c.participants ?? []) as Array<{ userId: PopulatedUser | Types.ObjectId }>;
    const others = parts.filter((p) => participantUserIdString(p) !== userId);
    const otherRaw = others[0]?.userId;
    const other =
      otherRaw && typeof otherRaw === 'object' && '_id' in (otherRaw as object) ? (otherRaw as PopulatedUser) : undefined;
    const otherName =
      other && typeof other === 'object' && '_id' in other
        ? `${other.name ?? 'Member'} (@${other.username ?? 'unknown'})`
        : 'Direct message';

    let title = '';
    if (c.type === 'group') title = typeof c.title === 'string' && c.title.trim() ? c.title : 'Group chat';
    else if (c.type === 'channel') title = typeof c.title === 'string' && c.title.trim() ? c.title : 'Channel chat';
    else title = otherName;

    const previewRaw = c.lastMessage?.previewText ?? '';
    return {
      id: String(c._id),
      type: c.type as string,
      title,
      isSecret: Boolean(c.isSecret),
      lastActivityAt: c.lastActivityAt ?? c.updatedAt,
      preview: stripEnc(typeof previewRaw === 'string' ? previewRaw : ''),
      participantCount: parts.length
    };
  });

  res.json({
    success: true,
    data: {
      user: {
        id: String(user._id),
        name: user.name,
        username: user.username,
        email: user.email
      },
      conversations: rows
    }
  });
}

/** GET /admin/chats/:conversationId/messages — moderation read; no participant membership check. */
export async function adminChatMessagesGet(req: Request, res: Response): Promise<void> {
  const paramId = singleParam(req.params.conversationId);
  if (!paramId) {
    res.status(400).json({ success: false, message: 'Conversation id required' });
    return;
  }

  const mongoConvId = await resolveVirtualConversationId(paramId);
  const conv = await ConversationModel.findById(mongoConvId).select('type title participants isSecret').lean();
  if (!conv) {
    res.status(404).json({ success: false, message: 'Conversation not found' });
    return;
  }

  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 80;
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 80;

  const messages = await MessageModel.find({ conversationId: mongoConvId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const listChatId = paramId.startsWith('dm:') ? paramId : String(mongoConvId);

  res.json({
    success: true,
    data: {
      conversationId: String(mongoConvId),
      listChatId,
      type: (conv as any).type,
      title: (conv as any).title ?? null,
      isSecret: Boolean((conv as any).isSecret),
      messages: messages.map((m: any) => ({
        id: String(m._id),
        chatId: listChatId,
        senderId: String(m.senderId),
        text: stripEnc(m.content?.text ?? ''),
        media: m.content?.mediaUrl ? { type: m.content.mediaType, uri: m.content.mediaUrl } : undefined,
        timestamp: m.createdAt,
        isEncrypted: Boolean(m.isEncrypted)
      }))
    }
  });
}
