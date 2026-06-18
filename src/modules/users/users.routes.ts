import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { completeProfileController, getMeController, getPublicUserController, updateMeController } from './users.controller';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, getMeController);
usersRouter.put('/me', requireAuth, updateMeController);
usersRouter.post('/profile', requireAuth, completeProfileController);

usersRouter.get('/:id', requireAuth, getPublicUserController);
