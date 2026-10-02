import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import {
  completeProfileController,
  deleteDevicePushTokenController,
  deleteMeController,
  getMeController,
  getPublicUserController,
  updateMeController,
  upsertDevicePushTokenController,
  upsertLegacyExpoPushTokenController
} from './users.controller';
import {
  blockUserController,
  listBlockedUsersController,
  unblockUserController
} from './user-block.controller';
import { asyncHandler } from '../../shared/errors';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, asyncHandler(getMeController));
usersRouter.put('/me', requireAuth, asyncHandler(updateMeController));
usersRouter.delete('/me', requireAuth, asyncHandler(deleteMeController));
usersRouter.post('/profile', requireAuth, asyncHandler(completeProfileController));
usersRouter.post('/push-token', requireAuth, asyncHandler(upsertLegacyExpoPushTokenController));
usersRouter.post('/devices/push-token', requireAuth, asyncHandler(upsertDevicePushTokenController));
usersRouter.delete('/devices/:deviceId/push-token', requireAuth, asyncHandler(deleteDevicePushTokenController));

usersRouter.get('/me/blocks', requireAuth, asyncHandler(listBlockedUsersController));
usersRouter.post('/:id/block', requireAuth, asyncHandler(blockUserController));
usersRouter.delete('/:id/block', requireAuth, asyncHandler(unblockUserController));

usersRouter.get('/:id', requireAuth, asyncHandler(getPublicUserController));
