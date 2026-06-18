import crypto from 'crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAdmin, requireAuth, type AuthedRequest } from '../../middleware/auth';
import { ChannelModel } from '../channels/channel.model';
import { UserModel } from '../users/user.model';
import { CreatorApplicationModel } from './creator-application.model';
import { ChannelSubscriptionModel } from './channel-subscription.model';
import { TipPaymentModel } from './tip-payment.model';
import { PayoutRecordModel } from './payout-record.model';

export const paymentsRouter = Router();

function asObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

function mockStripeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function buildMockCheckoutUrl(kind: 'subscription' | 'tip', id: string): string {
  return `https://checkout.stripe.com/pay/${kind}_${id}`;
}

paymentsRouter.post('/creator/applications', requireAuth, async (req: AuthedRequest, res) => {
  const channelId = typeof req.body.channelId === 'string' ? req.body.channelId : '';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

  if (!Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ success: false, message: 'Valid channelId is required' });
  }

  const channel = await ChannelModel.findById(channelId);
  if (!channel) {
    return res.status(404).json({ success: false, message: 'Channel not found' });
  }

  if (String(channel.ownerId) !== req.auth!.userId) {
    return res.status(403).json({ success: false, message: 'Only the channel owner can apply' });
  }

  const application = await CreatorApplicationModel.findOneAndUpdate(
    { channelId, userId: req.auth!.userId },
    {
      $set: {
        notes,
        status: 'pending'
      }
    },
    { new: true, upsert: true }
  );

  channel.monetisationStatus = 'pending';
  await channel.save();

  return res.status(201).json({
    success: true,
    data: {
      id: String(application._id),
      status: application.status,
      channelId
    }
  });
});

paymentsRouter.get('/creator/applications', requireAuth, async (req: AuthedRequest, res) => {
  const applications = await CreatorApplicationModel.find({ userId: req.auth!.userId }).sort({ updatedAt: -1 }).lean();
  const channelIds = applications.map((application) => application.channelId);
  const channels = await ChannelModel.find({ _id: { $in: channelIds } }).lean();
  const channelsById = new Map(channels.map((channel) => [String(channel._id), channel]));

  return res.json({
    success: true,
    data: applications.map((application) => {
      const channel = channelsById.get(String(application.channelId));
      return {
        id: String(application._id),
        channelId: String(application.channelId),
        status: application.status,
        notes: application.notes,
        reviewedAt: application.reviewedAt,
        createdAt: application.createdAt,
        channel: channel
          ? {
              id: String(channel._id),
              name: channel.name,
              icon: channel.icon,
              color: channel.color,
              accessType: channel.accessType,
              monthlyPriceUsd: channel.monthlyPriceUsd,
              monetisationStatus: channel.monetisationStatus
            }
          : null
      };
    })
  });
});

paymentsRouter.get('/admin/creator/applications', requireAdmin, async (_req, res) => {
  const applications = await CreatorApplicationModel.find().sort({ updatedAt: -1 }).limit(200).lean();
  const channelIds = applications.map((application) => application.channelId);
  const userIds = applications.map((application) => application.userId);
  const [channels, users] = await Promise.all([
    ChannelModel.find({ _id: { $in: channelIds } }).lean(),
    UserModel.find({ _id: { $in: userIds } }).lean()
  ]);
  const channelsById = new Map(channels.map((channel) => [String(channel._id), channel]));
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  return res.json({
    success: true,
    data: applications.map((application) => {
      const channel = channelsById.get(String(application.channelId));
      const user = usersById.get(String(application.userId));
      return {
        id: String(application._id),
        channelId: String(application.channelId),
        userId: String(application.userId),
        status: application.status,
        notes: application.notes,
        reviewedAt: application.reviewedAt,
        createdAt: application.createdAt,
        applicant: user
          ? {
              id: String(user._id),
              name: user.name,
              username: user.username
            }
          : null,
        channel: channel
          ? {
              id: String(channel._id),
              name: channel.name,
              icon: channel.icon,
              color: channel.color,
              accessType: channel.accessType,
              monthlyPriceUsd: channel.monthlyPriceUsd,
              monetisationStatus: channel.monetisationStatus
            }
          : null
      };
    })
  });
});

paymentsRouter.post('/creator/applications/:id/review', requireAdmin, async (req, res) => {
  const status = req.body.status === 'approved' ? 'approved' : req.body.status === 'rejected' ? 'rejected' : '';
  if (!status) {
    return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
  }

  const application = await CreatorApplicationModel.findById(req.params.id);
  if (!application) {
    return res.status(404).json({ success: false, message: 'Application not found' });
  }

  application.status = status;
  application.reviewedAt = new Date();
  await application.save();

  const [channel, user] = await Promise.all([
    ChannelModel.findById(application.channelId),
    UserModel.findById(application.userId)
  ]);

  if (channel) {
    channel.monetisationStatus = status;
    await channel.save();
  }

  if (user && status === 'approved') {
    user.creatorProfile = {
      ...user.creatorProfile,
      isCreator: true,
      stripeConnectAccountId: user.creatorProfile?.stripeConnectAccountId || mockStripeId('acct'),
      payoutsEnabled: true,
      onboardingCompletedAt: new Date()
    };
    await user.save();
  }

  return res.json({ success: true, data: { id: String(application._id), status } });
});

paymentsRouter.patch('/channels/:id/pricing', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) {
    return res.status(404).json({ success: false, message: 'Channel not found' });
  }

  if (String(channel.ownerId) !== req.auth!.userId) {
    return res.status(403).json({ success: false, message: 'Only the channel owner can update pricing' });
  }

  const accessType = req.body.accessType === 'paid' ? 'paid' : 'free';
  const monthlyPriceUsd = Number(req.body.monthlyPriceUsd ?? 0);

  if (accessType === 'paid' && (!Number.isFinite(monthlyPriceUsd) || monthlyPriceUsd < 1 || monthlyPriceUsd > 99)) {
    return res.status(400).json({ success: false, message: 'monthlyPriceUsd must be between 1 and 99 for paid channels' });
  }

  if (accessType === 'paid' && channel.monetisationStatus !== 'approved') {
    return res.status(403).json({ success: false, message: 'Creator application must be approved before enabling paid access' });
  }

  channel.accessType = accessType;
  channel.monthlyPriceUsd = accessType === 'paid' ? Math.round(monthlyPriceUsd) : 0;
  await channel.save();

  return res.json({
    success: true,
    data: {
      channelId: String(channel._id),
      accessType: channel.accessType,
      monthlyPriceUsd: channel.monthlyPriceUsd
    }
  });
});

paymentsRouter.post('/payments/channels/:id/subscribe', requireAuth, async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) {
    return res.status(404).json({ success: false, message: 'Channel not found' });
  }

  if (channel.accessType !== 'paid' || !channel.monthlyPriceUsd) {
    return res.status(400).json({ success: false, message: 'Channel is not paid' });
  }

  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const subscription = await ChannelSubscriptionModel.findOneAndUpdate(
    { userId: req.auth!.userId, channelId: String(channel._id) },
    {
      $set: {
        amountUsd: channel.monthlyPriceUsd,
        stripeCheckoutSessionId: mockStripeId('cs'),
        stripeSubscriptionId: mockStripeId('sub'),
        status: 'active',
        currentPeriodEnd,
        graceUntil: null
      }
    },
    { new: true, upsert: true }
  );

  const memberId = asObjectId(req.auth!.userId);
  if (!channel.members.some((member) => String(member) === req.auth!.userId)) {
    channel.members.push(memberId);
    await channel.save();
  }

  return res.status(201).json({
    success: true,
    data: {
      id: String(subscription._id),
      status: subscription.status,
      checkoutSessionId: subscription.stripeCheckoutSessionId,
      checkoutUrl: buildMockCheckoutUrl('subscription', subscription.stripeCheckoutSessionId),
      currentPeriodEnd: subscription.currentPeriodEnd
    }
  });
});

paymentsRouter.post('/payments/channels/:id/cancel', requireAuth, async (req: AuthedRequest, res) => {
  const subscription = await ChannelSubscriptionModel.findOne({
    userId: req.auth!.userId,
    channelId: req.params.id
  });

  if (!subscription) {
    return res.status(404).json({ success: false, message: 'Subscription not found' });
  }

  subscription.status = 'cancelled';
  await subscription.save();

  return res.json({ success: true, data: { id: String(subscription._id), status: subscription.status } });
});

paymentsRouter.post('/payments/tips', requireAuth, async (req: AuthedRequest, res) => {
  const toUserId = typeof req.body.toUserId === 'string' ? req.body.toUserId : '';
  const channelId = typeof req.body.channelId === 'string' ? req.body.channelId : undefined;
  const amountUsd = Number(req.body.amountUsd ?? 0);

  if (!Types.ObjectId.isValid(toUserId) || !Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 500) {
    return res.status(400).json({ success: false, message: 'Valid toUserId and amountUsd between 1 and 500 are required' });
  }

  const platformFeeUsd = Number((amountUsd * 0.1).toFixed(2));
  const creatorNetUsd = Number((amountUsd - platformFeeUsd).toFixed(2));

  const tip = await TipPaymentModel.create({
    fromUserId: req.auth!.userId,
    toUserId,
    channelId: channelId && Types.ObjectId.isValid(channelId) ? channelId : undefined,
    amountUsd,
    platformFeeUsd,
    creatorNetUsd,
    stripeCheckoutSessionId: mockStripeId('cs'),
    status: 'succeeded'
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(tip._id),
      amountUsd: tip.amountUsd,
      platformFeeUsd: tip.platformFeeUsd,
      creatorNetUsd: tip.creatorNetUsd,
      status: tip.status,
      checkoutUrl: buildMockCheckoutUrl('tip', tip.stripeCheckoutSessionId)
    }
  });
});

paymentsRouter.get('/creator/dashboard', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const ownedChannels = await ChannelModel.find({ ownerId: userId }).lean();
  const ownedChannelIds = ownedChannels.map((channel) => channel._id);

  const [subscriptions, tips, payouts] = await Promise.all([
    ChannelSubscriptionModel.find({ status: 'active', channelId: { $in: ownedChannelIds } }).lean(),
    TipPaymentModel.find({ toUserId: userId, status: 'succeeded' }).sort({ createdAt: -1 }).limit(20).lean(),
    PayoutRecordModel.find({ userId }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  const activeCount = subscriptions.length;
  const mrr = subscriptions.reduce((sum, subscription) => sum + subscription.amountUsd, 0);
  const churnRate = 0;

  return res.json({
    success: true,
    data: {
      mrr,
      subscriberCount: activeCount,
      churnRate,
      ownedChannels: ownedChannels.map((channel) => ({
        id: String(channel._id),
        name: channel.name,
        icon: channel.icon,
        color: channel.color,
        accessType: channel.accessType,
        monthlyPriceUsd: channel.monthlyPriceUsd,
        monetisationStatus: channel.monetisationStatus
      })),
      topTippers: tips.slice(0, 5).map((tip) => ({
        fromUserId: String(tip.fromUserId),
        amountUsd: tip.amountUsd,
        createdAt: tip.createdAt
      })),
      payoutHistory: payouts.map((payout) => ({
        id: String(payout._id),
        amountUsd: payout.amountUsd,
        status: payout.status,
        paidAt: payout.paidAt ?? payout.createdAt
      }))
    }
  });
});

paymentsRouter.post('/payments/webhooks/stripe', async (req, res) => {
  const type = typeof req.body.type === 'string' ? req.body.type : '';
  const subscriptionId = typeof req.body.subscriptionId === 'string' ? req.body.subscriptionId : '';

  if (!type) {
    return res.status(400).json({ success: false, message: 'Webhook type is required' });
  }

  if (subscriptionId) {
    const subscription = await ChannelSubscriptionModel.findOne({ stripeSubscriptionId: subscriptionId });
    if (subscription) {
      if (type === 'invoice.payment_failed') {
        subscription.status = 'grace_period';
        subscription.graceUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      }
      if (type === 'customer.subscription.deleted') {
        subscription.status = 'cancelled';
      }
      if (type === 'invoice.paid' || type === 'checkout.session.completed') {
        subscription.status = 'active';
        subscription.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
      await subscription.save();
    }
  }

  return res.json({ success: true, received: true });
});

