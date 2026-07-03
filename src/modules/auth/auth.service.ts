import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { env } from '../../config/env';
import { sendPasswordResetEmail, sendSignupVerificationEmail, type SendEmailResult } from '../../lib/email';
import { redis } from '../../config/redis';
import { UserModel } from '../users/user.model';
import { OtpModel } from './otp.model';
import { RefreshTokenModel } from './refresh-token.model';
import { normalizePhone } from '../../lib/phone';

type RegisterInput = {
  name: string;
  username: string;
  email: string;
  password: string;
  phone: string;
};

type LoginInput = {
  email: string;
  password: string;
};

function sixDigitOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Only expose OTP in API when email was not sent and Resend is not configured (local dev). */
function includeDevOtpInApiBody(emailResult: SendEmailResult): boolean {
  return (
    env.NODE_ENV !== 'production' && !emailResult.sent && emailResult.reason === 'not_configured'
  );
}

function createTokens(userId: string, role: 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst') {
  const accessToken = jwt.sign({ userId, role }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(
    { userId, role, tokenType: 'refresh', jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    {
      // Align with CON-003: 30 day refresh lifetime
      expiresIn: '30d'
    }
  );
  return { accessToken, refreshToken };
}

function refreshTokenRedisKey(hash: string) {
  return `refresh:${hash}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function storeRefreshTokenInRedis(token: string) {
  try {
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    if (!decoded || typeof decoded.exp !== 'number' || typeof decoded.userId !== 'string') return;
    const ttlMs = decoded.exp * 1000 - Date.now();
    if (ttlMs <= 0) return;
    const hash = hashToken(token);
    const key = refreshTokenRedisKey(hash);
    const payload = {
      userId: decoded.userId,
      jti: decoded.jti,
      exp: decoded.exp
    };
    await redis.set(key, JSON.stringify(payload), 'PX', ttlMs);
  } catch {
    // Redis is best-effort; auth still works without it in dev.
  }
}

async function revokeRefreshTokenInRedis(token: string) {
  try {
    const hash = hashToken(token);
    const key = refreshTokenRedisKey(hash);
    await redis.del(key);
  } catch {
    // Ignore Redis errors; Mongo remains source of truth.
  }
}

export async function registerUser(input: RegisterInput) {
  const normalizedPhone = normalizePhone(input.phone ?? '');
  if (!normalizedPhone) {
    return {
      status: StatusCodes.BAD_REQUEST,
      body: {
        success: false,
        message: 'Enter a valid phone number with country code (for example, +923001234567).',
        errorCode: 'INVALID_PHONE'
      }
    };
  }

  const emailLower = input.email.toLowerCase();
  const usernameLower = input.username.toLowerCase();

  const existing = await UserModel.findOne({
    $or: [{ email: emailLower }, { username: usernameLower }, { phone: normalizedPhone }]
  }).lean();

  if (existing) {
    if (!existing.isVerified && existing.email === emailLower && existing.phone === normalizedPhone) {
      return {
        status: StatusCodes.CONFLICT,
        body: {
          success: false,
          message: 'This account is waiting for email verification.',
          errorCode: 'ACCOUNT_PENDING_VERIFICATION',
          data: { userId: String(existing._id), email: existing.email }
        }
      };
    }
    let message = 'This account information is already in use.';
    let errorCode = 'ACCOUNT_ALREADY_EXISTS';
    if (existing.phone === normalizedPhone) {
      message = 'This phone number is already registered.';
      errorCode = 'PHONE_ALREADY_REGISTERED';
    } else if (existing.email === emailLower) {
      message = 'This email is already registered.';
      errorCode = 'EMAIL_ALREADY_REGISTERED';
    } else if (existing.username === usernameLower) {
      message = 'This username is already taken.';
      errorCode = 'USERNAME_ALREADY_TAKEN';
    }
    return {
      status: StatusCodes.CONFLICT,
      body: { success: false, message, errorCode }
    };
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await UserModel.create({
    name: input.name,
    username: usernameLower,
    email: emailLower,
    phone: normalizedPhone,
    passwordHash,
    // Signup already collects a unique username; skip duplicate “choose username” onboarding.
    hasCompletedProfile: true
  });

  const code = sixDigitOtp();
  await OtpModel.create({
    userId: user._id,
    code,
    type: 'signup',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });

  const signupEmailResult = await sendSignupVerificationEmail(user.email, code, user.name);

  if (!signupEmailResult.sent) {
    console.error('[auth] register: signup verification email not delivered', signupEmailResult);
    const mustRollback =
      env.NODE_ENV === 'production' || signupEmailResult.reason === 'request_failed';
    if (mustRollback) {
      await OtpModel.deleteMany({ userId: user._id });
      await UserModel.findByIdAndDelete(user._id);
      const detail =
        signupEmailResult.reason === 'not_configured'
          ? (signupEmailResult.detail ??
            'Email delivery is not configured on the server (set RESEND_API_KEY and EMAIL_FROM in backend .env).')
          : (signupEmailResult.detail ?? 'Email provider rejected the send.');
      return {
        status: StatusCodes.SERVICE_UNAVAILABLE,
        body: { success: false, message: `We could not send a verification email. ${detail}` }
      };
    }
  }

  return {
    status: StatusCodes.CREATED,
    body: {
      success: true,
      message: signupEmailResult.sent
        ? 'Registered. Check your email for a verification code.'
        : 'Registered. Verification email is not configured — use the dev code returned below (local only).',
      data: {
        userId: String(user._id),
        ...(includeDevOtpInApiBody(signupEmailResult) ? { otpCode: code } : {})
      }
    }
  };
}

export async function resendSignupOtp(userId: string) {
  const cooldownKey = `auth:signup-otp-cooldown:${userId}`;
  try {
    const coolingDown = await redis.get(cooldownKey);
    if (coolingDown) {
      return {
        status: StatusCodes.TOO_MANY_REQUESTS,
        body: { success: false, message: 'Please wait before requesting another code.', errorCode: 'OTP_RATE_LIMITED' }
      };
    }
  } catch {
    // Redis is optional; email delivery still works without rate-limit storage.
  }
  const user = await UserModel.findById(userId);
  if (!user) {
    return { status: StatusCodes.NOT_FOUND, body: { success: false, message: 'User not found' } };
  }
  if (user.isVerified) {
    return { status: StatusCodes.BAD_REQUEST, body: { success: false, message: 'This account is already verified' } };
  }

  try {
    await redis.set(cooldownKey, '1', 'EX', 60);
  } catch {
    // Best-effort cooldown.
  }

  const code = sixDigitOtp();
  const emailResult = await sendSignupVerificationEmail(user.email, code, user.name);

  if (!emailResult.sent) {
    console.error('[auth] resend-signup-otp: email not delivered', emailResult);
    if (env.NODE_ENV === 'production' || emailResult.reason === 'request_failed') {
      const detail =
        emailResult.reason === 'not_configured'
          ? (emailResult.detail ??
            'Email delivery is not configured on the server (set RESEND_API_KEY and EMAIL_FROM).')
          : (emailResult.detail ?? 'Email provider rejected the send.');
      return {
        status: StatusCodes.SERVICE_UNAVAILABLE,
        body: { success: false, message: `We could not send a verification email. ${detail}` }
      };
    }
    // Local dev without Resend: persist new OTP (verify reads DB) and return code in JSON only in this mode.
    await OtpModel.deleteMany({ userId: user._id, type: 'signup', used: false });
    await OtpModel.create({
      userId: user._id,
      code,
      type: 'signup',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });
    return {
      status: StatusCodes.OK,
      body: {
        success: true,
        message: 'Verification email is not configured — use the dev code returned below (local only).',
        data: { otpCode: code }
      }
    };
  }

  await OtpModel.deleteMany({ userId: user._id, type: 'signup', used: false });
  await OtpModel.create({
    userId: user._id,
    code,
    type: 'signup',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });

  return {
    status: StatusCodes.OK,
    body: {
      success: true,
      message: 'A new verification code has been sent to your email.',
      data: {}
    }
  };
}

export async function verifyOtp(userId: string, code: string) {
  const normalizedCode = code.trim();
  const otp = await OtpModel.findOne({
    userId,
    code: normalizedCode,
    type: 'signup',
    used: false,
    expiresAt: { $gt: new Date() }
  });

  if (!otp) {
    return {
      status: StatusCodes.BAD_REQUEST,
      body: { success: false, message: 'The verification code is invalid or expired.', errorCode: 'OTP_INVALID_OR_EXPIRED' }
    };
  }

  otp.used = true;
  await otp.save();

  const user = await UserModel.findByIdAndUpdate(userId, { isVerified: true }, { new: true });
  if (!user) {
    return { status: StatusCodes.NOT_FOUND, body: { success: false, message: 'User not found' } };
  }

  const role = (user.role as 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst') ?? 'user';
  const { accessToken, refreshToken } = createTokens(String(user._id), role);

  await RefreshTokenModel.create({
    userId: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });
  await storeRefreshTokenInRedis(refreshToken);

  return {
    status: StatusCodes.OK,
    body: {
      success: true,
      message: 'Email verified',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: String(user._id),
          name: user.name,
          username: user.username,
          email: user.email,
          isVerified: user.isVerified,
          hasCompletedProfile: user.hasCompletedProfile
        }
      }
    }
  };
}

export async function loginUser(input: LoginInput) {
  const user = await UserModel.findOne({ email: input.email.toLowerCase() });
  if (!user) {
    return { status: StatusCodes.UNAUTHORIZED, body: { success: false, message: 'Email or password is incorrect.', errorCode: 'INVALID_CREDENTIALS' } };
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    return { status: StatusCodes.UNAUTHORIZED, body: { success: false, message: 'Email or password is incorrect.', errorCode: 'INVALID_CREDENTIALS' } };
  }
  if (!user.isVerified) {
    return {
      status: StatusCodes.FORBIDDEN,
      body: {
        success: false,
        message: 'Please verify your email before signing in.',
        errorCode: 'EMAIL_NOT_VERIFIED',
        data: { userId: String(user._id), email: user.email }
      }
    };
  }
  if (user.isSuspended) {
    return { status: StatusCodes.FORBIDDEN, body: { success: false, message: 'Account suspended. Contact support.' } };
  }

  const role = (user.role as 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst') ?? 'user';
  const { accessToken, refreshToken } = createTokens(String(user._id), role);

  await RefreshTokenModel.create({
    userId: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });
  await storeRefreshTokenInRedis(refreshToken);

  return {
    status: StatusCodes.OK,
    body: {
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: String(user._id),
          name: user.name,
          username: user.username,
          email: user.email,
          isVerified: user.isVerified,
          hasCompletedProfile: user.hasCompletedProfile
        }
      }
    }
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const stored = await RefreshTokenModel.findOne({ token: refreshToken, isRevoked: false });
  if (!stored || stored.expiresAt < new Date()) {
    return { status: StatusCodes.UNAUTHORIZED, body: { success: false, message: 'Refresh token invalid or expired' } };
  }

  // Redis-backed validation for faster blacklist / rotation checks
  try {
    const hash = hashToken(refreshToken);
    const redisEntry = await redis.get(refreshTokenRedisKey(hash));
    if (!redisEntry) {
      return { status: StatusCodes.UNAUTHORIZED, body: { success: false, message: 'Refresh token invalid or expired' } };
    }
  } catch {
    // If Redis is unavailable, fall back to Mongo-only behaviour
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    return { status: StatusCodes.UNAUTHORIZED, body: { success: false, message: 'Refresh token invalid' } };
  }

  const userId = String(payload.userId);
  const role = (payload.role as 'user' | 'admin' | 'super_admin' | 'moderator' | 'analyst') ?? 'user';
  const tokens = createTokens(userId, role);

  stored.isRevoked = true;
  await stored.save();
  await RefreshTokenModel.create({
    userId,
    token: tokens.refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });
  await revokeRefreshTokenInRedis(refreshToken);
  await storeRefreshTokenInRedis(tokens.refreshToken);

  return {
    status: StatusCodes.OK,
    body: {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }
    }
  };
}

export async function logoutUser(userId: string, refreshToken: string) {
  const updated = await RefreshTokenModel.findOneAndUpdate(
    { userId, token: refreshToken, isRevoked: false },
    { isRevoked: true }
  );

  if (!updated) {
    // Treat logout as idempotent so clients can safely call it even if token was already rotated/revoked.
    const exists = await RefreshTokenModel.findOne({ userId, token: refreshToken }).lean();
    if (exists) {
      await revokeRefreshTokenInRedis(refreshToken);
      return { status: StatusCodes.OK, body: { success: true, message: 'Logged out successfully' } };
    }
    return { status: StatusCodes.OK, body: { success: true, message: 'Already logged out' } };
  }

  await revokeRefreshTokenInRedis(refreshToken);
  return { status: StatusCodes.OK, body: { success: true, message: 'Logged out successfully' } };
}

export async function forgotPassword(email: string) {
  const user = await UserModel.findOne({ email: email.toLowerCase() });

  // Always return success to avoid account enumeration.
  if (!user) {
    return {
      status: StatusCodes.OK,
      body: { success: true, message: 'If this email exists, a reset OTP has been sent.' }
    };
  }

  const code = sixDigitOtp();
  await OtpModel.deleteMany({ userId: user._id, type: 'reset_password', used: false });
  await OtpModel.create({
    userId: user._id,
    code,
    type: 'reset_password',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000)
  });

  const emailResult = await sendPasswordResetEmail(user.email, code, user.name);
  if (!emailResult.sent && env.NODE_ENV === 'production') {
    console.error('[auth] forgot-password: reset email was not delivered', emailResult);
  }

  return {
    status: StatusCodes.OK,
    body: {
      success: true,
      message: 'If this email exists, a reset OTP has been sent.',
      data: {
        ...(includeDevOtpInApiBody(emailResult) ? { otpCode: code } : {})
      }
    }
  };
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user) {
    return { status: StatusCodes.BAD_REQUEST, body: { success: false, message: 'Invalid reset request' } };
  }

  const otp = await OtpModel.findOne({
    userId: user._id,
    code,
    type: 'reset_password',
    used: false,
    expiresAt: { $gt: new Date() }
  });

  if (!otp) {
    return { status: StatusCodes.BAD_REQUEST, body: { success: false, message: 'Invalid or expired reset code' } };
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  otp.used = true;
  await otp.save();

  // Security hardening: revoke all active refresh tokens after password reset
  await RefreshTokenModel.updateMany({ userId: user._id, isRevoked: false }, { isRevoked: true });

  return { status: StatusCodes.OK, body: { success: true, message: 'Password reset successful' } };
}
