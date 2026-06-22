import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { AuthedRequest } from '../../middleware/auth';
import { UserModel } from './user.model';
import { updateMeSchema } from './users.schemas';
import { resolveStoredMediaUrl } from '../../lib/r2';
export async function getMeController(req: AuthedRequest, res: Response) {
  const user = await UserModel.findById(req.auth!.userId).lean();
  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;

  return res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: String(user._id),
      username: user.username,
      email: user.email,
      phone: user.phone,
      name: user.name,
      bio: user.bio,
      avatar,
      hasCompletedProfile: user.hasCompletedProfile,
      settings: user.settings,
      role: user.role,
      isVerified: user.isVerified,
      isSuspended: user.isSuspended,
      region: user.region,
      creatorProfile: user.creatorProfile
    }
  });
}

export async function updateMeController(req: AuthedRequest, res: Response) {
  const parsed = updateMeSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: parsed.error.flatten() });
  }

  const user = await UserModel.findByIdAndUpdate(req.auth!.userId, parsed.data.body, { new: true }).lean();
  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;
  if (parsed.data.body.settings) {
    console.log('[users.updateMe.settings]', {
      userId: req.auth!.userId,
      readReceiptsEnabled: user.settings?.readReceiptsEnabled,
      showLastSeen: user.settings?.showLastSeen,
    });
  }

  return res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: String(user._id),
      username: user.username,
      email: user.email,
      phone: user.phone,
      name: user.name,
      bio: user.bio,
      avatar,
      hasCompletedProfile: user.hasCompletedProfile,
      settings: user.settings,
      role: user.role,
      isVerified: user.isVerified,
      isSuspended: user.isSuspended,
      region: user.region,
      creatorProfile: user.creatorProfile
    }
  });
}

export async function getPublicUserController(req: AuthedRequest, res: Response) {
  const user = await UserModel.findById(req.params.id).lean();
  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;
  return res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: String(user._id),
      username: user.username,
      name: user.name,
      phone: user.phone ?? '',
      bio: user.bio,
      avatar,
      hasCompletedProfile: user.hasCompletedProfile
    }
  });
}

export async function completeProfileController(req: AuthedRequest, res: Response) {
  const parsed = updateMeSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: parsed.error.flatten() });
  }

  const user = await UserModel.findByIdAndUpdate(
    req.auth!.userId,
    { ...parsed.data.body, hasCompletedProfile: true },
    { new: true }
  ).lean();

  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;

  return res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: String(user._id),
      username: user.username,
      email: user.email,
      phone: user.phone,
      name: user.name,
      bio: user.bio,
      avatar,
      hasCompletedProfile: user.hasCompletedProfile,
      settings: user.settings,
      role: user.role,
      isVerified: user.isVerified,
      isSuspended: user.isSuspended,
      region: user.region,
      creatorProfile: user.creatorProfile
    }
  });
}

export async function registerPushTokenController(req: AuthedRequest, res: Response) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token.startsWith('ExponentPushToken[')) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid Expo push token' });
  }

  await UserModel.findByIdAndUpdate(req.auth!.userId, {
    $addToSet: { expoPushTokens: token },
  });

  return res.status(StatusCodes.OK).json({ success: true });
}
