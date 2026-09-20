import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { LiveLocationSessionModel } from '../src/modules/messages/live-location.model';
import {
  isAllowedLiveLocationDuration,
  isValidLatLng,
  LIVE_LOCATION_ALLOWED_DURATIONS_SEC,
  parseLocationCoord,
} from '../src/modules/messages/live-location.shared';
import { MessageModel } from '../src/modules/messages/message.model';

describe('live location shared validation', () => {
  it('allows only WhatsApp-style live durations', () => {
    expect([...LIVE_LOCATION_ALLOWED_DURATIONS_SEC]).toEqual([900, 3600, 28800]);
    expect(isAllowedLiveLocationDuration(900)).toBe(true);
    expect(isAllowedLiveLocationDuration(3600)).toBe(true);
    expect(isAllowedLiveLocationDuration(28800)).toBe(true);
    expect(isAllowedLiveLocationDuration(0)).toBe(false);
    expect(isAllowedLiveLocationDuration(1800)).toBe(false);
    expect(isAllowedLiveLocationDuration(86400)).toBe(false);
  });

  it('parses finite coordinates and rejects junk', () => {
    expect(parseLocationCoord(31.52)).toBe(31.52);
    expect(parseLocationCoord('74.35')).toBe(74.35);
    expect(parseLocationCoord('nope')).toBeNull();
    expect(parseLocationCoord(undefined)).toBeNull();
    expect(parseLocationCoord(Number.NaN)).toBeNull();
  });

  it('validates lat/lng bounds', () => {
    expect(isValidLatLng(31.52, 74.35)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
  });
});

describe('location message + live session models', () => {
  it('accepts static location messages with lat/lng metadata', () => {
    const message = new MessageModel({
      conversationId: new Types.ObjectId(),
      senderId: new Types.ObjectId(),
      content: {
        text: '📍 Location',
        mediaType: 'location',
        metadata: { lat: 31.5204, lng: 74.3587, live: false },
      },
    });
    expect(message.validateSync()).toBeUndefined();
    expect(message.content?.mediaType).toBe('location');
    expect(message.content?.metadata?.lat).toBe(31.5204);
  });

  it('accepts live location reply snapshots', () => {
    const message = new MessageModel({
      conversationId: new Types.ObjectId(),
      senderId: new Types.ObjectId(),
      content: { text: '📍 Live location', mediaType: 'location' },
      replyTo: {
        messageId: new Types.ObjectId(),
        senderId: new Types.ObjectId(),
        previewText: '📍 Location',
        mediaType: 'location',
      },
    });
    expect(message.validateSync()).toBeUndefined();
    expect(message.replyTo?.mediaType).toBe('location');
  });

  it('requires conversation, user, coords, and expiry for a live session', () => {
    const expiresAt = new Date(Date.now() + 900_000);
    const session = new LiveLocationSessionModel({
      conversationId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      lat: 31.52,
      lng: 74.35,
      expiresAt,
    });
    expect(session.validateSync()).toBeUndefined();
    expect(session.stoppedAt).toBeNull();
    expect(session.expiresAt).toEqual(expiresAt);
  });

  it('rejects a live session without coordinates', () => {
    const session = new LiveLocationSessionModel({
      conversationId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      expiresAt: new Date(Date.now() + 900_000),
    });
    const errors = session.validateSync()?.errors;
    expect(errors?.lat).toBeDefined();
    expect(errors?.lng).toBeDefined();
  });
});

describe('live location HTTP routes', () => {
  const app = createApp();

  it('requires auth to start a live session', async () => {
    const response = await request(app).post(`${env.API_PREFIX}/live-location/start`).send({
      conversationId: new Types.ObjectId().toString(),
      durationSec: 900,
      lat: 31.52,
      lng: 74.35,
    });
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('requires auth to update a live session', async () => {
    const response = await request(app)
      .post(`${env.API_PREFIX}/live-location/${new Types.ObjectId().toString()}/update`)
      .send({ lat: 31.53, lng: 74.36 });
    expect(response.status).toBe(401);
  });

  it('requires auth to stop a live session', async () => {
    const response = await request(app).post(
      `${env.API_PREFIX}/live-location/${new Types.ObjectId().toString()}/stop`
    );
    expect(response.status).toBe(401);
  });
});
