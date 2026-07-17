import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendSignupOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema
} from './auth.schemas';
import {
  forgotPassword,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
  resendSignupOtp,
  resetPassword,
  verifyOtp
} from './auth.service';
import type { AuthedRequest } from '../../middleware/auth';
import type { ZodError } from 'zod';
import type { AuthRequestMetadata } from './auth.service';

function validationFailure(res: Response, error: ZodError) {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[issue.path[0] === 'body' ? 1 : 0] ?? 'form');
    fields[field] = [...(fields[field] ?? []), issue.message];
  }
  return res.status(400).json({
    success: false,
    message: 'Please correct the highlighted fields.',
    errorCode: 'VALIDATION_ERROR',
    fields,
    requestId: res.locals.requestId
  });
}

function requestMetadata(req: Request): AuthRequestMetadata {
  return {
    ipAddress: req.ip || '',
    userAgent: req.get('user-agent') || '',
    platform: req.get('x-connectify-platform') || '',
    appVersion: req.get('x-connectify-app-version') || ''
  };
}

export async function registerController(req: Request, res: Response) {
  const parsed = registerSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await registerUser(parsed.data.body, requestMetadata(req));
  return res.status(result.status).json(result.body);
}

export async function verifyOtpController(req: Request, res: Response) {
  const parsed = verifyOtpSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await verifyOtp(parsed.data.body.userId, parsed.data.body.code.trim());
  return res.status(result.status).json(result.body);
}

export async function resendSignupOtpController(req: Request, res: Response) {
  const parsed = resendSignupOtpSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await resendSignupOtp(parsed.data.body.userId);
  return res.status(result.status).json(result.body);
}

export async function loginController(req: Request, res: Response) {
  const parsed = loginSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await loginUser(parsed.data.body, requestMetadata(req));
  return res.status(result.status).json(result.body);
}

export async function refreshController(req: Request, res: Response) {
  const parsed = refreshSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await refreshAccessToken(parsed.data.body.refreshToken);
  return res.status(result.status).json(result.body);
}

export async function logoutController(req: AuthedRequest, res: Response) {
  const parsed = logoutSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await logoutUser(
    req.auth!.userId,
    parsed.data.body.refreshToken,
    parsed.data.body.deviceId
  );
  return res.status(result.status).json(result.body);
}

export async function forgotPasswordController(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await forgotPassword(parsed.data.body.email);
  return res.status(result.status).json(result.body);
}

export async function resetPasswordController(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    return validationFailure(res, parsed.error);
  }
  const result = await resetPassword(parsed.data.body.email, parsed.data.body.code, parsed.data.body.newPassword);
  return res.status(result.status).json(result.body);
}
