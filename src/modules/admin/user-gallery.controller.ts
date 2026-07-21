import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { MessageModel } from '../messages/message.model';
import { resolveStoredMediaUrl } from '../../lib/r2';
import type { AuthedRequest } from '../../middleware/auth';
import { requireAdminCapability, canAdminAccessUser } from './access';

const MEDIA_TYPES = ['image', 'video', 'file', 'voice'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

type GalleryItem = {
  kind: 'message' | 'avatar';
  id: string;
  caption: string;
  createdAt: Date;
  mediaType: MediaType | 'image';
  mediaUrls: string[];
  conversationId?: string;
};

function isMediaType(value: unknown): value is MediaType {
  return typeof value === 'string' && (MEDIA_TYPES as readonly string[]).includes(value);
}

/** GET /admin/users/:userId/gallery — media this member shared in chats (plus avatar). */
export async function adminUserGalleryGet(req: Request, res: Response): Promise<void> {
  const actor = await requireAdminCapability(req as AuthedRequest, res, 'user_management');
  if (!actor) return;

  const rawId = req.params.userId;
  const userId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(400).json({ success: false, message: 'Invalid user id' });
    return;
  }
  if (!(await canAdminAccessUser(actor, userId))) {
    res.status(403).json({ success: false, message: 'You cannot access this user' });
    return;
  }

  const user = await UserModel.findById(userId).select('name username email avatar').lean();
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
  const messages = await MessageModel.find({
    senderId: new Types.ObjectId(userId),
    'content.mediaUrl': { $exists: true, $type: 'string', $ne: '' }
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('content conversationId createdAt')
    .lean();

  const items: GalleryItem[] = (
    await Promise.all(
      messages.map(async (msg) => {
        const rawUrl = typeof msg.content?.mediaUrl === 'string' ? msg.content.mediaUrl.trim() : '';
        if (!rawUrl) return null;
        const mediaType = isMediaType(msg.content?.mediaType) ? msg.content.mediaType : 'file';
        const mediaUrl = await resolveStoredMediaUrl(rawUrl);
        if (!mediaUrl) return null;
        return {
          kind: 'message' as const,
          id: String(msg._id),
          caption: typeof msg.content?.text === 'string' ? msg.content.text : '',
          createdAt: msg.createdAt,
          mediaType,
          mediaUrls: [mediaUrl],
          conversationId: String(msg.conversationId)
        };
      })
    )
  ).filter((item): item is GalleryItem => item !== null);

  const avatarRaw = typeof user.avatar === 'string' ? user.avatar.trim() : '';
  const avatarUrl = avatarRaw ? await resolveStoredMediaUrl(avatarRaw) : '';
  if (avatarUrl) {
    items.unshift({
      kind: 'avatar',
      id: `avatar-${String(user._id)}`,
      caption: 'Profile photo',
      createdAt: new Date(0),
      mediaType: 'image',
      mediaUrls: [avatarUrl]
    });
  }

  res.json({
    success: true,
    data: {
      user: {
        id: String(user._id),
        name: user.name,
        username: user.username,
        email: user.email,
        avatarUrl
      },
      items
    }
  });
}

