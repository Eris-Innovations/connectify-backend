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

export const authRouter = Router();

authRouter.post('/register', registerController);
authRouter.post('/login', loginController);
authRouter.post('/verify-otp', verifyOtpController);
authRouter.post('/resend-signup-otp', resendSignupOtpController);
authRouter.post('/forgot-password', forgotPasswordController);
authRouter.post('/reset-password', resetPasswordController);
authRouter.post('/refresh', refreshController);
authRouter.post('/logout', requireAuth, logoutController);

