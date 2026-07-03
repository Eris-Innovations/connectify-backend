import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import {
  forgotPasswordController,
  loginController,
  logoutController,
  refreshController,
  registerController,
  resetPasswordController,
  resendSignupOtpController,
  verifyOtpController
} from './auth.controller';
import { asyncHandler } from '../../shared/errors';

export const authRouter = Router();

authRouter.post('/register', asyncHandler(registerController));
authRouter.post('/login', asyncHandler(loginController));
authRouter.post('/verify-otp', asyncHandler(verifyOtpController));
authRouter.post('/resend-signup-otp', asyncHandler(resendSignupOtpController));
authRouter.post('/forgot-password', asyncHandler(forgotPasswordController));
authRouter.post('/reset-password', asyncHandler(resetPasswordController));
authRouter.post('/refresh', asyncHandler(refreshController));
authRouter.post('/logout', requireAuth, asyncHandler(logoutController));
