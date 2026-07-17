import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { AuthedRequest } from '../../middleware/auth';
import { UserModel } from './user.model';
import { updateMeSchema } from './users.schemas';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { DevicePushTokenModel } from './device-push-token.model';
import { isUserConnected } from '../../sockets/io';

export async function getMeController(req: AuthedRequest, res: Response) {
  const user = await UserModel.findById(req.auth!.userId).lean();
  if (!user) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }
  const avatar = user.avatar ? await resolveStoredMediaUrl(user.avatar) : user.avatar;
  const pushTokenCount = await DevicePushTokenModel.countDocuments({
    userId: req.auth!.userId,
    enabled: true,
  });

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
  const showLastSeen = user.settings?.showLastSeen !== false;
  const online = showLastSeen ? isUserConnected(String(user._id)) : false;
  return res.status(StatusCodes.OK).json({
    success: true,
    data: {
      id: String(user._id),
      username: user.username,
      name: user.name,
      phone: user.phone ?? '',
      bio: user.bio,
      avatar,
      hasCompletedProfile: user.hasCompletedProfile,
      showLastSeen,
      isOnline: online,
      lastSeenAt: showLastSeen && user.lastSeenAt ? user.lastSeenAt : undefined,
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

  // Enforce unique token ownership across accounts (logout / account switch safety).
  const detachQuery: Record<string, unknown>[] = [];
  if (expoToken) detachQuery.push({ expoToken });
  if (fcmToken) detachQuery.push({ fcmToken });
  if (detachQuery.length > 0) {
    await DevicePushTokenModel.deleteMany({
      userId: { $ne: req.auth!.userId },
      $or: detachQuery
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
