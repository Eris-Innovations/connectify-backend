import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { AuthedRequest } from '../../middleware/auth';
import { UserModel } from './user.model';
import { updateMeSchema } from './users.schemas';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { DevicePushTokenModel } from './device-push-token.model';
export async function getMeController(req: AuthedRequest, res: Response) {
  const user = await UserModel.findById(req.auth!.userId).lean();
  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;
  const pushTokenCount = Array.isArray(user.expoPushTokens)
    ? user.expoPushTokens.filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken[')).length
    : 0;

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
      pushTokenCount,
      role: user.role,
      adminScope: user.adminScope,
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

  const { settings, ...profileFields } = parsed.data.body;
  const update: Record<string, unknown> = { ...profileFields };
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) update[`settings.${key}`] = value;
    }
  }
  const user = await UserModel.findByIdAndUpdate(req.auth!.userId, { $set: update }, { new: true }).lean();
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
      adminScope: user.adminScope,
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
      adminScope: user.adminScope,
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

  console.log('[push.token] registered', {
    userId: req.auth!.userId,
    tokenPrefix: token.slice(0, 28),
  });

  return res.status(StatusCodes.OK).json({ success: true });
}

export async function upsertDevicePushTokenController(req: AuthedRequest, res: Response) {
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const platform = req.body?.platform === 'android' || req.body?.platform === 'ios' ? req.body.platform : '';
  const expoToken = typeof req.body?.expoToken === 'string' ? req.body.expoToken.trim() : '';
  const fcmToken = typeof req.body?.fcmToken === 'string' ? req.body.fcmToken.trim() : '';
  if (!deviceId || deviceId.length > 200 || !platform || (!expoToken && !fcmToken)) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Invalid device registration.',
      errorCode: 'INVALID_DEVICE_REGISTRATION',
      requestId: res.locals.requestId
    });
  }

  const row = await DevicePushTokenModel.findOneAndUpdate(
    { userId: req.auth!.userId, deviceId },
    {
      $set: {
        platform,
        expoToken,
        fcmToken,
        enabled: req.body?.enabled !== false,
        messageEnabled: req.body?.messageEnabled !== false,
        callEnabled: req.body?.callEnabled !== false,
        appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion.slice(0, 40) : '',
        lastSeenAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (expoToken.startsWith('ExponentPushToken[')) {
    await UserModel.findByIdAndUpdate(req.auth!.userId, { $addToSet: { expoPushTokens: expoToken } });
  }
  return res.status(StatusCodes.OK).json({ success: true, data: { id: String(row!._id) } });
}

export async function deleteDevicePushTokenController(req: AuthedRequest, res: Response) {
  const deviceId = Array.isArray(req.params.deviceId) ? req.params.deviceId[0] : req.params.deviceId;
  if (!deviceId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Device id is required.' });
  }
  await DevicePushTokenModel.deleteOne({ userId: req.auth!.userId, deviceId });
  return res.status(StatusCodes.OK).json({ success: true });
}
