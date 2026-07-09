import { Resend } from 'resend';
import { env } from '../config/env';

export function isPasswordResetEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/** Same as password reset — one Resend key powers all transactional mail. */
export const isTransactionalEmailConfigured = isPasswordResetEmailConfigured;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPasswordResetHtml(code: string, displayName?: string) {
  const safeName = displayName?.trim() ? escapeHtml(displayName.trim()) : '';
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';
  const safeCode = escapeHtml(code);
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:480px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:700;margin:0 0 16px;">Connectify</p>
  <p style="margin:0 0 8px;">${greeting}</p>
  <p style="margin:0 0 16px;">Use this code to reset your password. It expires in <strong>5 minutes</strong>.</p>
  <p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:24px 0;padding:16px 20px;background:#f3f4f6;border-radius:12px;text-align:center;">${safeCode}</p>
  <p style="color:#6b7280;font-size:14px;margin:24px 0 0;">If you did not request a password reset, you can ignore this email.</p>
</body>
</html>`;
}

function buildPasswordResetText(code: string, displayName?: string) {
  const greeting = displayName?.trim() ? `Hi ${displayName.trim()},` : 'Hi,';
  return [
    'Connectify',
    '',
    greeting,
    '',
    'Use this code to reset your password. It expires in 5 minutes.',
    '',
    code,
    '',
    'If you did not request a password reset, you can ignore this email.'
  ].join('\n');
}

function buildSignupVerificationHtml(code: string, displayName?: string) {
  const safeName = displayName?.trim() ? escapeHtml(displayName.trim()) : '';
  const greeting = safeName ? `Hi ${safeName},` : 'Hi,';
  const safeCode = escapeHtml(code);
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:480px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:700;margin:0 0 16px;">Connectify</p>
  <p style="margin:0 0 8px;">${greeting}</p>
  <p style="margin:0 0 16px;">Thanks for signing up. Enter this code in the app to verify your email. It expires in <strong>5 minutes</strong>.</p>
  <p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:24px 0;padding:16px 20px;background:#f3f4f6;border-radius:12px;text-align:center;">${safeCode}</p>
  <p style="color:#6b7280;font-size:14px;margin:24px 0 0;">If you did not create a Connectify account, you can ignore this email.</p>
</body>
</html>`;
}

function buildSignupVerificationText(code: string, displayName?: string) {
  const greeting = displayName?.trim() ? `Hi ${displayName.trim()},` : 'Hi,';
  return [
    'Connectify',
    '',
    greeting,
    '',
    'Thanks for signing up. Enter this code in the app to verify your email. It expires in 5 minutes.',
    '',
    code,
    '',
    'If you did not create a Connectify account, you can ignore this email.'
  ].join('\n');
}

export type SendEmailResult = { sent: true } | { sent: false; reason: 'not_configured' | 'request_failed'; detail?: string };

const EMAIL_FROM_MISSING_DETAIL =
  'EMAIL_FROM is not set. Verify your domain at https://resend.com/domains, then set EMAIL_FROM to a sender on that domain (e.g. Connectify <noreply@yourdomain.com>).';

/**
 * Password reset email via Resend (official SDK).
 * Set `RESEND_API_KEY` and `EMAIL_FROM` in `.env` — never hardcode the key in source.
 */
export async function sendPasswordResetEmail(to: string, code: string, displayName?: string): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (env.NODE_ENV !== 'production') {
      console.info(`[email] RESEND_API_KEY not set — dev password reset OTP for ${to}: ${code}`);
    } else {
      console.warn('[email] RESEND_API_KEY not set — password reset email was not sent');
    }
    return { sent: false, reason: 'not_configured' };
  }

  const from = env.EMAIL_FROM?.trim();
  if (!from) {
    if (env.NODE_ENV !== 'production') {
      console.info(`[email] EMAIL_FROM not set — password reset email not sent (OTP for ${to}: ${code})`);
    } else {
      console.warn('[email] EMAIL_FROM not set — password reset email was not sent');
    }
    return { sent: false, reason: 'not_configured', detail: EMAIL_FROM_MISSING_DETAIL };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: to.toLowerCase(),
      subject: 'Your Connectify password reset code',
      html: buildPasswordResetHtml(code, displayName),
      text: buildPasswordResetText(code, displayName)
    });

    if (error) {
      const detail = typeof error.message === 'string' ? error.message : JSON.stringify(error);
      console.error('[email] Resend password reset failed:', detail);
      return { sent: false, reason: 'request_failed', detail };
    }

    if (!data?.id) {
      console.error('[email] Resend returned no message id', data);
      return { sent: false, reason: 'request_failed', detail: 'No message id in response' };
    }

    return { sent: true };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[email] Resend password reset failed:', detail);
    return { sent: false, reason: 'request_failed', detail };
  }
}

/** Signup / email verification OTP (same Resend config as password reset). */
export async function sendSignupVerificationEmail(
  to: string,
  code: string,
  displayName?: string
): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (env.NODE_ENV !== 'production') {
      console.info(`[email] RESEND_API_KEY not set — dev signup OTP for ${to}: ${code}`);
    } else {
      console.warn('[email] RESEND_API_KEY not set — signup verification email was not sent');
    }
    return { sent: false, reason: 'not_configured' };
  }

  const from = env.EMAIL_FROM?.trim();
  if (!from) {
    if (env.NODE_ENV !== 'production') {
      console.info(`[email] EMAIL_FROM not set — signup verification email not sent (OTP for ${to}: ${code})`);
    } else {
      console.warn('[email] EMAIL_FROM not set — signup verification email was not sent');
    }
    return { sent: false, reason: 'not_configured', detail: EMAIL_FROM_MISSING_DETAIL };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: to.toLowerCase(),
      subject: 'Verify your Connectify email',
      html: buildSignupVerificationHtml(code, displayName),
      text: buildSignupVerificationText(code, displayName)
    });

    if (error) {
      const detail = typeof error.message === 'string' ? error.message : JSON.stringify(error);
      console.error('[email] Resend signup verification failed:', detail);
      return { sent: false, reason: 'request_failed', detail };
    }

    if (!data?.id) {
      console.error('[email] Resend returned no message id', data);
      return { sent: false, reason: 'request_failed', detail: 'No message id in response' };
    }

    return { sent: true };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[email] Resend signup verification failed:', detail);
    return { sent: false, reason: 'request_failed', detail };
  }
}
