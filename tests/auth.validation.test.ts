import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

describe('auth input validation', () => {
  const app = createApp();

  it('rejects invalid login payload', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/auth/login`).send({
      email: 'bad-email',
      password: '123'
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects invalid reset-password payload', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/auth/reset-password`).send({
      email: 'demo@example.com',
      code: '123',
      newPassword: 'short'
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects invalid resend-signup-otp payload', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/auth/resend-signup-otp`).send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});

