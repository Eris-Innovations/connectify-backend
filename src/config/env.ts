import dotenv from 'dotenv';
import { z } from 'zod';
import { isR2S3CompatibleAccessKeyId, R2_S3_CREDENTIALS_HELP } from './r2Credentials';

dotenv.config();

/** Trim whitespace; treat empty string as undefined (common .env copy/paste issue). */
function optionalTrimmed(field: string) {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (v == null || v === '') return undefined;
      const t = v.trim();
      if (t === '') return undefined;
      return t;
    })
    .superRefine((val, ctx) => {
      if (val != null && /\s/.test(val)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must not contain whitespace` });
      }
    });
}

/** Optional string trimmed; allows inner spaces (e.g. `Name <email@domain.com>`). */
function optionalTrimmedLoose() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (v == null || v === '') return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** Must be non-empty and start with `/` (empty `API_PREFIX=` in .env would otherwise mount at `/` while clients call `/api/v1`). */
  API_PREFIX: z
    .union([z.string(), z.undefined()])
    .transform((v) => {
      const t = (typeof v === 'string' ? v : '').trim();
      if (!t) return '/api/v1';
      return t.startsWith('/') ? t : `/${t}`;
    }),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/connectify'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().default('dev_access_secret'),
  JWT_REFRESH_SECRET: z.string().default('dev_refresh_secret'),
  CLAUDE_API_KEY: z.string().optional(),
  CLAUDE_API_URL: z.string().default('https://api.anthropic.com/v1/messages'),
  CLAUDE_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  /** OpenAI API key for Whisper speech-to-text (voice message / audio transcripts). */
  OPENAI_API_KEY: optionalTrimmed('OPENAI_API_KEY'),
  OPENAI_WHISPER_MODEL: z.string().default('whisper-1'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  R2_ACCOUNT_ID: optionalTrimmed('R2_ACCOUNT_ID'),
  R2_ENDPOINT: optionalTrimmed('R2_ENDPOINT').pipe(z.union([z.string().url(), z.undefined()])),
  R2_BUCKET: optionalTrimmed('R2_BUCKET'),
  R2_ACCESS_KEY_ID: optionalTrimmed('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: optionalTrimmed('R2_SECRET_ACCESS_KEY'),
  R2_PUBLIC_BASE_URL: optionalTrimmed('R2_PUBLIC_BASE_URL').pipe(z.union([z.string().url(), z.undefined()])),
  DEFAULT_DATA_REGION: z.enum(['eu', 'apac', 'na']).default('na'),
  /** Resend API key for transactional email (password reset). */
  RESEND_API_KEY: optionalTrimmed('RESEND_API_KEY'),
  /** Sender on a domain verified in Resend, e.g. `Connectify <noreply@yourdomain.com>` (required with RESEND_API_KEY). */
  EMAIL_FROM: optionalTrimmedLoose(),
  /** Optional Expo access token for higher push rate limits (EAS project). */
  EXPO_ACCESS_TOKEN: optionalTrimmed('EXPO_ACCESS_TOKEN')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;

const WEAK_JWT_SECRETS = new Set(['dev_access_secret', 'dev_refresh_secret']);
if (env.NODE_ENV === 'production') {
  if (
    WEAK_JWT_SECRETS.has(env.JWT_ACCESS_SECRET) ||
    WEAK_JWT_SECRETS.has(env.JWT_REFRESH_SECRET) ||
    env.JWT_ACCESS_SECRET.length < 32 ||
    env.JWT_REFRESH_SECRET.length < 32
  ) {
    throw new Error(
      'Invalid environment: in production, JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set to ' +
        'unique random strings of at least 32 characters (not the default dev values).'
    );
  }
}

const r2Configured =
  Boolean(env.R2_ENDPOINT) &&
  Boolean(env.R2_BUCKET) &&
  Boolean(env.R2_ACCESS_KEY_ID) &&
  Boolean(env.R2_SECRET_ACCESS_KEY);

if (r2Configured && env.R2_ACCESS_KEY_ID && !isR2S3CompatibleAccessKeyId(env.R2_ACCESS_KEY_ID)) {
  console.warn(`[R2] R2_ACCESS_KEY_ID is not S3-compatible (need exactly 32 chars, not cfat_…). ${R2_S3_CREDENTIALS_HELP}`);
}
if (r2Configured && env.R2_ENDPOINT?.includes(env.R2_BUCKET ?? '__no_bucket__')) {
  console.warn(
    `[R2] R2_ENDPOINT should not include the bucket path (…/connectify). Use https://<account_id>.r2.cloudflarestorage.com and set R2_BUCKET separately.`
  );
}

