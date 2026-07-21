import { z } from 'zod';
import { normalizePhone } from '../../lib/phone';

const phoneField = z
  .string()
  .min(8, 'Phone number is too short')
  .max(24, 'Phone number is too long')
  .refine((v) => normalizePhone(v) !== null, { message: 'Enter a valid phone number with country code' });

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_.]+$/),
    email: z.string().email(),
    password: z.string().min(8),
    phone: phoneField
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8)
  })
});

export const verifyOtpSchema = z.object({
  body: z.object({
    userId: z.string().min(1),
    code: z.string().trim().length(6)
  })
});

export const resendSignupOtpSchema = z.object({
  body: z.object({
    userId: z.string().min(1)
  })
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1)
  })
});

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
    deviceId: z.string().trim().min(1).max(200).optional()
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email()
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
    code: z.string().length(6),
    newPassword: z.string().min(8)
  })
});

