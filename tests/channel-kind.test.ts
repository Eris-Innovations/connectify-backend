import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  effectiveChannelKind,
  isBroadcastChannel,
  isChannelAdmin,
  isChannelFollower,
} from '../src/modules/channels/channel-kind';
import { ChannelModel } from '../src/modules/channels/channel.model';
import { ChannelPostModel } from '../src/modules/channels/channel-post.model';

describe('channel kind helpers', () => {
  it('treats missing kind as legacy', () => {
    expect(effectiveChannelKind({})).toBe('legacy');
    expect(effectiveChannelKind({ kind: 'legacy' })).toBe('legacy');
    expect(isBroadcastChannel({ kind: 'broadcast' })).toBe(true);
    expect(isBroadcastChannel({ kind: 'legacy' })).toBe(false);
  });

  it('recognizes owner and admins', () => {
    const ownerId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const otherId = new Types.ObjectId();
    const channel = { ownerId, admins: [adminId] };
    expect(isChannelAdmin(channel, String(ownerId))).toBe(true);
    expect(isChannelAdmin(channel, String(adminId))).toBe(true);
    expect(isChannelAdmin(channel, String(otherId))).toBe(false);
  });

  it('detects followers', () => {
    const followerId = new Types.ObjectId();
    expect(isChannelFollower({ followers: [followerId] }, String(followerId))).toBe(true);
    expect(isChannelFollower({ followers: [] }, String(followerId))).toBe(false);
  });
});

describe('channel + post models', () => {
  it('creates a broadcast channel with followers', () => {
    const ownerId = new Types.ObjectId();
    const channel = new ChannelModel({
      name: 'News',
      ownerId,
      kind: 'broadcast',
      followers: [ownerId],
    });
    expect(channel.validateSync()).toBeUndefined();
    expect(channel.kind).toBe('broadcast');
  });

  it('defaults kind to legacy for backward safety', () => {
    const channel = new ChannelModel({
      name: 'Legacy Club',
      ownerId: new Types.ObjectId(),
    });
    expect(channel.kind).toBe('legacy');
  });

  it('stores a channel post', () => {
    const post = new ChannelPostModel({
      channelId: new Types.ObjectId(),
      authorId: new Types.ObjectId(),
      text: 'Hello followers',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example/a.jpg',
    });
    expect(post.validateSync()).toBeUndefined();
  });
});
