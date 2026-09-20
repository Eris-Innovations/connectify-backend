import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import {
  distanceMeters,
  isAllowedNearbyRadius,
  NEARBY_ALLOWED_RADII_M,
  nearbyStaleCutoff,
  NEARBY_STALE_MS,
} from '../src/modules/nearby/nearby.shared';

describe('nearby shared helpers', () => {
  it('allows only the four product radii', () => {
    expect([...NEARBY_ALLOWED_RADII_M]).toEqual([100, 500, 1000, 5000]);
    expect(isAllowedNearbyRadius(500)).toBe(true);
    expect(isAllowedNearbyRadius(250)).toBe(false);
  });

  it('computes haversine distance roughly', () => {
    // ~111m north of equator origin
    const d = distanceMeters(0, 0, 0.001, 0);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(130);
  });

  it('stale cutoff is 5 minutes behind now', () => {
    const now = Date.parse('2026-09-20T12:00:00.000Z');
    expect(nearbyStaleCutoff(now).toISOString()).toBe(
      new Date(now - NEARBY_STALE_MS).toISOString()
    );
  });
});

describe('nearby HTTP auth gates', () => {
  const app = createApp();

  it('requires auth for ping, disable, and list', async () => {
    expect(
      (await request(app).post(`${env.API_PREFIX}/nearby/ping`).send({ lat: 31.52, lng: 74.35 })).status
    ).toBe(401);
    expect((await request(app).post(`${env.API_PREFIX}/nearby/disable`)).status).toBe(401);
    expect(
      (await request(app).get(`${env.API_PREFIX}/nearby`).query({ lat: 31.52, lng: 74.35, radius: 500 }))
        .status
    ).toBe(401);
  });
});
