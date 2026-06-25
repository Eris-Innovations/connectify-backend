import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { UserModel } from '../users/user.model';
import { presignGetUrl } from '../../lib/r2';
import type { AuthedRequest } from '../../middleware/auth';
import { requireAdminCapability, canAdminAccessUser } from './access';

type GalleryItem = {
  kind: 'post' | 'story';
  id: string;
  caption: string;
  createdAt: Date;
  expiresAt?: Date;
  mediaUrls: string[];
};

/** GET /admin/users/:userId/gallery — feed posts and stories are disabled; returns an empty gallery. */
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

  const items: GalleryItem[] = [];

  const avatarRaw = typeof user.avatar === 'string' ? user.avatar.trim() : '';
  const avatarUrl = avatarRaw ? await presignGetUrl(avatarRaw) : '';

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
