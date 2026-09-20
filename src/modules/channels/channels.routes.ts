import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { resolveStoredMediaUrl } from '../../lib/r2';
import { clampSearchQuery, escapeMongoRegex } from '../../lib/mongoRegex';
import { ChannelModel } from './channel.model';
import { ChannelPostModel } from './channel-post.model';
import { ChannelSubscriptionModel } from '../payments/channel-subscription.model';
import {
  isBroadcastChannel,
  isChannelAdmin,
  isChannelFollower,
  effectiveChannelKind,
} from './channel-kind';
import { emitToUser } from '../../sockets/io';

export const channelsRouter = Router();

function mapChannelListItem(c: any, userId?: string) {
  const kind = effectiveChannelKind(c);
  const followerCount = Array.isArray(c.followers) ? c.followers.length : 0;
  const memberCount = Array.isArray(c.members) ? c.members.length : 0;
  return {
    id: String(c._id),
    name: c.name,
    description: c.description ?? '',
    ownerId: String(c.ownerId),
    icon: c.icon,
    color: c.color,
    kind,
    isPublic: Boolean(c.isPublic),
    members: `${memberCount}`,
    memberCount,
    followerCount,
    isActive: true,
    accessType: c.accessType,
    monthlyPriceUsd: c.monthlyPriceUsd,
    monetisationStatus: c.monetisationStatus,
    isFollowing: userId ? isChannelFollower(c, userId) : false,
    isAdmin: userId ? isChannelAdmin(c, userId) : false,
  };
}

channelsRouter.get('/channels', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const q = clampSearchQuery(typeof req.query.q === 'string' ? req.query.q : '');
  const literal = q ? escapeMongoRegex(q) : '';
  const kindFilter =
    req.query.kind === 'broadcast' || req.query.kind === 'legacy' ? req.query.kind : undefined;
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  const following = req.query.following === '1' || req.query.following === 'true';

  const query: Record<string, unknown> = {};
  if (literal) {
    query.$or = [
      { name: { $regex: literal, $options: 'i' } },
      { description: { $regex: literal, $options: 'i' } },
    ];
  }
  if (kindFilter) query.kind = kindFilter;
  if (mine) {
    query.$and = [
      ...(Array.isArray(query.$and) ? query.$and : []),
      {
        $or: [
          { ownerId: userId },
          { admins: userId },
          { members: userId },
          { followers: userId },
        ],
      },
    ];
  }
  if (following) {
    query.kind = 'broadcast';
    query.followers = userId;
  }

  const channels = await ChannelModel.find(query).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({
    success: true,
    data: channels.map((c) => mapChannelListItem(c, userId)),
  });
});

channelsRouter.post('/channels', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  const description =
    typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : '';
  const icon = typeof req.body?.icon === 'string' ? req.body.icon.trim().slice(0, 8) : '📢';
  const color =
    typeof req.body?.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(req.body.color.trim())
      ? req.body.color.trim()
      : '#3B7EF8';

  if (!name) {
    return res.status(400).json({ success: false, message: 'Channel name is required' });
  }

  const uid = new Types.ObjectId(userId);
  const channel = await ChannelModel.create({
    name,
    description,
    icon,
    color,
    ownerId: uid,
    kind: 'broadcast',
    isPublic: true,
    followers: [uid],
    admins: [],
    members: [],
  });

  return res.status(201).json({
    success: true,
    data: mapChannelListItem(channel.toObject(), userId),
  });
});

channelsRouter.get('/channels/:id', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const [channel, subscription] = await Promise.all([
    ChannelModel.findById(req.params.id).lean(),
    ChannelSubscriptionModel.findOne({ channelId: req.params.id, userId, status: 'active' }).lean(),
  ]);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

  const isMember = Boolean(
    String(channel.ownerId) === userId || channel.members.some((m) => String(m) === userId)
  );
  const base = mapChannelListItem(channel, userId);
  return res.json({
    success: true,
    data: {
      ...base,
      hasActiveSubscription: Boolean(subscription),
      isMember,
      isFollowing: isChannelFollower(channel, userId),
      isAdmin: isChannelAdmin(channel, userId),
    },
  });
});

channelsRouter.post('/channels/:id/join', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  if (isBroadcastChannel(channel)) {
    return res.status(400).json({
      success: false,
      message: 'Use follow for broadcast channels',
    });
  }

  const uid = new Types.ObjectId(req.auth!.userId);
  const joined = channel.members.some((m) => String(m) === String(uid));
  channel.members = joined
    ? channel.members.filter((m) => String(m) !== String(uid))
    : [...channel.members, uid];
  await channel.save();

  return res.json({ success: true, data: { joined: !joined, members: channel.members.length } });
});

channelsRouter.post('/channels/:id/follow', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  if (!isBroadcastChannel(channel)) {
    return res.status(400).json({ success: false, message: 'Only broadcast channels can be followed' });
  }

  const uid = new Types.ObjectId(req.auth!.userId);
  if (channel.followers.some((m) => String(m) === String(uid))) {
    return res.status(409).json({ success: false, message: 'Already following' });
  }
  channel.followers.push(uid);
  await channel.save();
  return res.json({
    success: true,
    data: { following: true, followerCount: channel.followers.length },
  });
});

channelsRouter.post('/channels/:id/unfollow', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  if (!isBroadcastChannel(channel)) {
    return res.status(400).json({ success: false, message: 'Only broadcast channels can be unfollowed' });
  }

  const uid = String(req.auth!.userId);
  if (String(channel.ownerId) === uid) {
    return res.status(400).json({ success: false, message: 'Owner cannot unfollow their channel' });
  }
  const before = channel.followers.length;
  channel.followers = channel.followers.filter((m) => String(m) !== uid);
  if (channel.followers.length === before) {
    return res.status(409).json({ success: false, message: 'Not following' });
  }
  await channel.save();
  return res.json({
    success: true,
    data: { following: false, followerCount: channel.followers.length },
  });
});

channelsRouter.get('/channels/:id/posts', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const channel = await ChannelModel.findById(req.params.id).lean();
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

  const canRead =
    channel.isPublic ||
    isChannelAdmin(channel, userId) ||
    isChannelFollower(channel, userId) ||
    channel.members.some((m) => String(m) === userId);
  if (!canRead) {
    return res.status(403).json({ success: false, message: 'Follow this channel to see posts' });
  }

  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 30) || 30));
  const before = typeof req.query.before === 'string' ? req.query.before : '';
  const query: Record<string, unknown> = { channelId: channel._id };
  if (before && Types.ObjectId.isValid(before)) {
    query._id = { $lt: new Types.ObjectId(before) };
  }

  const posts = await ChannelPostModel.find(query).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = posts.length > limit;
  const visible = posts.slice(0, limit);

  const data = await Promise.all(
    visible.map(async (p) => ({
      id: String(p._id),
      channelId: String(p.channelId),
      authorId: String(p.authorId),
      text: p.text,
      mediaUrl: p.mediaUrl ? await resolveStoredMediaUrl(p.mediaUrl) : '',
      mediaType: p.mediaType || undefined,
      createdAt: p.createdAt,
    }))
  );

  return res.json({
    success: true,
    data,
    pagination: {
      hasMore,
      nextCursor: hasMore ? String(visible[visible.length - 1]?._id ?? '') : null,
    },
  });
});

channelsRouter.post('/channels/:id/posts', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  if (!isBroadcastChannel(channel)) {
    return res.status(400).json({ success: false, message: 'Posts are only for broadcast channels' });
  }
  if (!isChannelAdmin(channel, userId)) {
    return res.status(403).json({ success: false, message: 'Only channel admins can post' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
  const mediaUrl = typeof req.body?.mediaUrl === 'string' ? req.body.mediaUrl.trim() : '';
  const rawMediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType.trim() : '';
  const mediaType =
    mediaUrl && (rawMediaType === 'image' || rawMediaType === 'video' || rawMediaType === 'file')
      ? rawMediaType
      : '';

  if (!text && !mediaUrl) {
    return res.status(400).json({ success: false, message: 'Post text or media is required' });
  }

  const post = await ChannelPostModel.create({
    channelId: channel._id,
    authorId: userId,
    text: text || (mediaType === 'image' ? '📷 Photo' : mediaType === 'video' ? '🎥 Video' : '📎 File'),
    mediaUrl: mediaUrl || undefined,
    mediaType: mediaType || undefined,
  });

  const payload = {
    id: String(post._id),
    channelId: String(channel._id),
    authorId: userId,
    text: post.text,
    mediaUrl: mediaUrl ? await resolveStoredMediaUrl(mediaUrl) : '',
    mediaType: mediaType || undefined,
    createdAt: post.createdAt,
    channelName: channel.name,
  };

  for (const follower of channel.followers) {
    emitToUser(String(follower), 'channel:post', payload);
  }

  return res.status(201).json({ success: true, data: payload });
});
