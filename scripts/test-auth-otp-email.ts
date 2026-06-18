import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { connectMongo } from '../src/config/db';
import { env } from '../src/config/env';
import { UserModel } from '../src/modules/users/user.model';
import { OtpModel } from '../src/modules/auth/otp.model';

type CheckRow = { step: string; ok: boolean; detail: string };

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0] ?? '*'}*@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

function printSummary(rows: CheckRow[]) {
  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.step} | ${r.detail}`);
  }
}

async function run() {
  const app = createApp();
  const now = Date.now();
  const domainFromEnv = process.env.AUTH_TEST_EMAIL_DOMAIN?.trim() || 'example.com';
  const testEmail = process.env.AUTH_TEST_EMAIL?.trim() || `qa.auth.${now}@${domainFromEnv}`;
  const username = `qa_auth_${now}`;
  const initialPassword = 'Password123!';
  const nextPassword = 'NewPass123!';
  const rows: CheckRow[] = [];

  await connectMongo();
  console.log(`Running auth/email OTP integration for ${maskEmail(testEmail)}`);
  console.log(`API prefix: ${env.API_PREFIX}`);

  try {
    const registerRes = await request(app).post(`${env.API_PREFIX}/auth/register`).send({
      name: 'QA Auth',
      username,
      email: testEmail,
      password: initialPassword
    });

    rows.push({
      step: 'register',
      ok: registerRes.status === 201,
      detail: `status=${registerRes.status}; message=${String(registerRes.body?.message ?? '')}`
    });

    const user = await UserModel.findOne({ email: testEmail }).lean();
    rows.push({
      step: 'user_created',
      ok: Boolean(user?._id),
      detail: user?._id ? `userId=${String(user._id)}` : 'user not found'
    });

    const signupOtp = user
      ? await OtpModel.findOne({ userId: user._id, type: 'signup', used: false }).sort({ createdAt: -1 }).lean()
      : null;

    rows.push({
      step: 'signup_otp_generated',
      ok: Boolean(signupOtp?.code),
      detail: signupOtp?.code ? `otp=${signupOtp.code}` : 'signup OTP not found'
    });

    if (user?._id && signupOtp?.code) {
      const verifyRes = await request(app)
        .post(`${env.API_PREFIX}/auth/verify-otp`)
        .send({ userId: String(user._id), code: signupOtp.code });
      rows.push({
        step: 'verify_signup_otp',
        ok: verifyRes.status === 200,
        detail: `status=${verifyRes.status}; message=${String(verifyRes.body?.message ?? '')}`
      });
    } else {
      rows.push({
        step: 'verify_signup_otp',
        ok: false,
        detail: 'skipped because user or signup OTP missing'
      });
    }

    const forgotRes = await request(app).post(`${env.API_PREFIX}/auth/forgot-password`).send({ email: testEmail });
    rows.push({
      step: 'forgot_password_request',
      ok: forgotRes.status === 200,
      detail: `status=${forgotRes.status}; message=${String(forgotRes.body?.message ?? '')}`
    });

    const resetOtp = user
      ? await OtpModel.findOne({ userId: user._id, type: 'reset_password', used: false })
          .sort({ createdAt: -1 })
          .lean()
      : null;
    rows.push({
      step: 'reset_otp_generated',
      ok: Boolean(resetOtp?.code),
      detail: resetOtp?.code ? `otp=${resetOtp.code}` : 'reset OTP not found'
    });

    if (resetOtp?.code) {
      const resetRes = await request(app).post(`${env.API_PREFIX}/auth/reset-password`).send({
        email: testEmail,
        code: resetOtp.code,
        newPassword: nextPassword
      });
      rows.push({
        step: 'reset_password',
        ok: resetRes.status === 200,
        detail: `status=${resetRes.status}; message=${String(resetRes.body?.message ?? '')}`
      });
    } else {
      rows.push({
        step: 'reset_password',
        ok: false,
        detail: 'skipped because reset OTP missing'
      });
    }

    const loginNewPass = await request(app).post(`${env.API_PREFIX}/auth/login`).send({
      email: testEmail,
      password: nextPassword
    });
    rows.push({
      step: 'login_with_new_password',
      ok: loginNewPass.status === 200,
      detail: `status=${loginNewPass.status}`
    });

    printSummary(rows);

    const failed = rows.filter((r) => !r.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Integration test crashed:', error);
  process.exit(1);
});

