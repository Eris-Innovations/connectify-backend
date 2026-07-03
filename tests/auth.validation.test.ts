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
    expect(response.body.errorCode).toBe('VALIDATION_ERROR');
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.fields.email).toBeDefined();
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

  it('rejects an invalid international phone number', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/auth/register`).send({
      name: 'Test User',
      username: 'test_user',
      email: 'test@example.com',
      phone: '+920000000000',
      password: 'password123'
    });

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('VALIDATION_ERROR');
    expect(response.body.fields.phone).toBeDefined();
  });
});
