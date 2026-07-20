import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import {
  completeProfileController,
  deleteDevicePushTokenController,
  getMeController,
  getPublicUserController,
  updateMeController,
  upsertDevicePushTokenController,
  upsertLegacyExpoPushTokenController
} from './users.controller';
import { asyncHandler } from '../../shared/errors';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, asyncHandler(getMeController));
usersRouter.put('/me', requireAuth, asyncHandler(updateMeController));
usersRouter.post('/profile', requireAuth, asyncHandler(completeProfileController));
usersRouter.post('/push-token', requireAuth, asyncHandler(upsertLegacyExpoPushTokenController));
usersRouter.post('/devices/push-token', requireAuth, asyncHandler(upsertDevicePushTokenController));
usersRouter.delete('/devices/:deviceId/push-token', requireAuth, asyncHandler(deleteDevicePushTokenController));

usersRouter.get('/:id', requireAuth, asyncHandler(getPublicUserController));
