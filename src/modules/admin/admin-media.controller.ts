import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { MessageModel } from '../messages/message.model';
import { resolveStoredMediaUrl } from '../../lib/r2';
import type { AuthedRequest } from '../../middleware/auth';
import { requireAdminCapability } from './access';

const MEDIA_TYPES = ['image', 'video', 'file', 'voice'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

function isMediaType(value: unknown): value is MediaType {
  return typeof value === 'string' && (MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * GET /admin/media — paginated media shared in chats by members the admin can access.
 * Query: limit, before (ISO date cursor), mediaType, q (sender name/username/email)
 */
export async function adminMediaList(req: Request, res: Response): Promise<void> {
  const actor = await requireAdminCapability(req as AuthedRequest, res, 'user_management');
  if (!actor) return;

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 48));
  const beforeRaw = typeof req.query.before === 'string' ? req.query.before.trim() : '';
  const beforeDate = beforeRaw ? new Date(beforeRaw) : null;
  const mediaTypeFilter =
    typeof req.query.mediaType === 'string' && isMediaType(req.query.mediaType) ? req.query.mediaType : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';

  const isScoped = actor.role === 'admin' && actor.adminScope === 'assigned';
  let allowedSenderIds: Types.ObjectId[] | null = null;

  if (isScoped) {
    const assigned = await UserModel.find({ role: 'user', assignedAdminId: actor._id }).select('_id').lean();
    allowedSenderIds = assigned.map((u) => u._id as Types.ObjectId);
    if (!allowedSenderIds.length) {
      res.json({ success: true, data: { items: [], hasMore: false } });
      return;
    }
  }

  if (q) {
    const escape = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchedUsers = await UserModel.find({
      role: 'user',
      ...(allowedSenderIds ? { _id: { $in: allowedSenderIds } } : {}),
      $or: [
        { name: { $regex: escape, $options: 'i' } },
        { username: { $regex: escape, $options: 'i' } },
        { email: { $regex: escape, $options: 'i' } }
      ]
    })
      .select('_id')
      .limit(200)
      .lean();
    allowedSenderIds = matchedUsers.map((u) => u._id as Types.ObjectId);
    if (!allowedSenderIds.length) {
      res.json({ success: true, data: { items: [], hasMore: false } });
      return;
    }
  }

  const filter: Record<string, unknown> = {
    'content.mediaUrl': { $exists: true, $nin: [null, ''] },
    'content.mediaType': mediaTypeFilter ? mediaTypeFilter : { $in: [...MEDIA_TYPES] }
  };
  if (allowedSenderIds) {
    filter.senderId = { $in: allowedSenderIds };
  }
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) {
    filter.createdAt = { $lt: beforeDate };
  }

  const messages = await MessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .select('content conversationId senderId createdAt')
    .lean();

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  const senderIds = [...new Set(page.map((m) => String(m.senderId)))];
  const senders = senderIds.length
    ? await UserModel.find({ _id: { $in: senderIds.map((id) => new Types.ObjectId(id)) } })
        .select('name username email')
        .lean()
    : [];
  const senderById = new Map(senders.map((u) => [String(u._id), u]));

  const items = await Promise.all(
    page.map(async (msg) => {
      const rawUrl = typeof msg.content?.mediaUrl === 'string' ? msg.content.mediaUrl.trim() : '';
      const mediaType = isMediaType(msg.content?.mediaType) ? msg.content.mediaType : 'file';
      const mediaUrl = rawUrl ? await resolveStoredMediaUrl(rawUrl) : '';
      const sender = senderById.get(String(msg.senderId));
      return {
        id: String(msg._id),
        mediaUrl,
        mediaType,
        caption: typeof msg.content?.text === 'string' ? msg.content.text : '',
        createdAt: msg.createdAt,
        conversationId: String(msg.conversationId),
        sender: {
          id: String(msg.senderId),
          name: sender?.name ?? 'Unknown',
          username: sender?.username ?? '',
          email: sender?.email ?? ''
        }
      };
    })
  );

  res.json({
    success: true,
    data: {
      items,
      hasMore,
      nextBefore: hasMore && page.length ? page[page.length - 1]!.createdAt : null
    }
  });
}
