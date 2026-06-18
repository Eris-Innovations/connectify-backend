import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { ChannelModel } from './channel.model';
import { ChannelSubscriptionModel } from '../payments/channel-subscription.model';
import { clampSearchQuery, escapeMongoRegex } from '../../lib/mongoRegex';

export const channelsRouter = Router();

channelsRouter.get('/channels', requireAuth, async (req, res) => {
  const q = clampSearchQuery(typeof req.query.q === 'string' ? req.query.q : '');
  const literal = q ? escapeMongoRegex(q) : '';
  const query = literal
    ? { $or: [{ name: { $regex: literal, $options: 'i' } }, { description: { $regex: literal, $options: 'i' } }] }
    : {};
  const channels = await ChannelModel.find(query).sort({ createdAt: -1 }).limit(50).lean();

  const data = channels.map((c) => ({
    id: String(c._id),
    name: c.name,
    description: c.description,
    ownerId: String(c.ownerId),
    icon: c.icon,
    color: c.color,
    members: `${c.members.length}`,
    isActive: true,
    accessType: c.accessType,
    monthlyPriceUsd: c.monthlyPriceUsd,
    monetisationStatus: c.monetisationStatus
  }));

  return res.json({ success: true, data });
});

channelsRouter.get('/channels/:id', requireAuth, async (req, res) => {
  const authed = req as AuthedRequest;
  const userId = authed.auth?.userId;
  const [channel, subscription] = await Promise.all([
    ChannelModel.findById(req.params.id).lean(),
    ChannelSubscriptionModel.findOne({ channelId: req.params.id, userId, status: 'active' }).lean()
  ]);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  const isMember = Boolean(
    userId && (String(channel.ownerId) === userId || channel.members.some((m) => String(m) === userId))
  );
  return res.json({
    success: true,
    data: {
      id: String(channel._id),
      name: channel.name,
      description: channel.description,
      ownerId: String(channel.ownerId),
      icon: channel.icon,
      color: channel.color,
      members: `${channel.members.length}`,
      isActive: true,
      accessType: channel.accessType,
      monthlyPriceUsd: channel.monthlyPriceUsd,
      monetisationStatus: channel.monetisationStatus,
      hasActiveSubscription: Boolean(subscription),
      isMember
    }
  });
});

channelsRouter.post('/channels/:id/join', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

  const uid = new Types.ObjectId(req.auth!.userId);
  const joined = channel.members.some((m) => String(m) === String(uid));
  channel.members = joined ? channel.members.filter((m) => String(m) !== String(uid)) : [...channel.members, uid];
  await channel.save();

  return res.json({ success: true, data: { joined: !joined, members: channel.members.length } });
});

