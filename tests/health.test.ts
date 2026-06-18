import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

describe('health endpoint', () => {
  it('returns service health payload', async () => {
    const app = createApp();
    const response = await request(app).get(`${env.API_PREFIX}/health`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.service).toBe('connectify-backend');
    expect(typeof response.body.uptime).toBe('number');
  });
});

