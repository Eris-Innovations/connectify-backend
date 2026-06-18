import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAdminRoles, type AuthedRequest } from '../../middleware/auth';
import { UserModel } from '../users/user.model';
import { ChannelModel } from '../channels/channel.model';
import { MessageModel } from '../messages/message.model';
import { CallModel } from '../calls/call.model';
import { AuditLogModel } from '../compliance/audit-log.model';
import { ReportedContentModel } from './reported-content.model';
import { RefreshTokenModel } from '../auth/refresh-token.model';
import { adminUserGalleryGet } from './user-gallery.controller';
import { adminUserChatsList, adminChatMessagesGet } from './user-chats.controller';
import { TranscriptModel } from '../ai/transcript.model';
import { clampSearchQuery, escapeMongoRegex } from '../../lib/mongoRegex';

export const adminRouter = Router();

async function logAdminAction(input: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const actor = await UserModel.findById(input.actorUserId).lean();
  await AuditLogModel.create({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    region: actor?.region ?? 'na',
    metadata: input.metadata ?? {}
  });
}

adminRouter.get('/admin/analytics/overview', requireAdminRoles(['admin', 'super_admin', 'analyst']), async (_req, res) => {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = new Date(now - 30 * oneDayMs);
  const ninetyDaysAgo = new Date(now - 90 * oneDayMs);

  const [dau, mau, messagesToday, callMinutesToday, signupsToday, signups30d, signups90d] = await Promise.all([
    UserModel.countDocuments({ updatedAt: { $gte: new Date(now - oneDayMs) } }),
    UserModel.countDocuments({ updatedAt: { $gte: thirtyDaysAgo } }),
    MessageModel.countDocuments({ createdAt: { $gte: new Date(now - oneDayMs) } }),
    CallModel.aggregate([
      { $match: { createdAt: { $gte: new Date(now - oneDayMs) } } },
      { $group: { _id: null, minutes: { $sum: { $divide: [{ $ifNull: ['$duration', 0] }, 60] } } } }
    ]),
    UserModel.countDocuments({ createdAt: { $gte: new Date(now - oneDayMs) } }),
    UserModel.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    UserModel.aggregate([
      { $match: { createdAt: { $gte: ninetyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])
  ]);

  return res.json({
    success: true,
    data: {
      dau,
      mau,
      messagesPerDay: messagesToday,
      callMinutesPerDay: Math.round(Number(callMinutesToday?.[0]?.minutes ?? 0)),
      newSignupsToday: signupsToday,
      signups30d,
      signups90d
    }
  });
});

adminRouter.get('/admin/activities', requireAdminRoles(['admin', 'super_admin']), async (_req, res) => {
  const [recentUsers, recentLogins] = await Promise.all([
    UserModel.find().sort({ createdAt: -1 }).limit(30).lean(),
    RefreshTokenModel.find().sort({ createdAt: -1 }).limit(30).lean()
  ]);

  const loginUserIds = [...new Set(recentLogins.map((t) => String(t.userId)).filter((id) => Types.ObjectId.isValid(id)))];
  const actorIdSet = new Set([...loginUserIds]);
  const actorDocs = actorIdSet.size
    ? await UserModel.find({ _id: { $in: [...actorIdSet].map((id) => new Types.ObjectId(id)) } })
        .select('name username email')
        .lean()
    : [];
  const actorById = new Map(actorDocs.map((u) => [String(u._id), u]));

  const activities = [
    ...recentUsers.map((user) => ({
      id: `user-created-${String(user._id)}`,
      type: 'user_created',
      actorId: String(user._id),
      actorName: user.name,
      actorUsername: user.username,
      actorEmail: user.email,
      title: 'New member',
      detail: 'They can now use Connectify',
      createdAt: user.createdAt
    })),
    ...recentLogins.map((token) => {
      const uid = String(token.userId);
      const u = actorById.get(uid);
      return {
        id: `session-created-${String(token._id)}`,
        type: 'session_created',
        actorId: uid,
        actorName: u?.name,
        actorUsername: u?.username,
        actorEmail: u?.email,
        title: 'Signed in',
        detail: token.isRevoked ? 'Session was later ended' : 'Session is active',
        createdAt: token.createdAt
      };
    })
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return res.json({ success: true, data: activities.slice(0, 100) });
});

adminRouter.get('/admin/channels', requireAdminRoles(['admin', 'super_admin', 'moderator']), async (_req, res) => {
  const channels = await ChannelModel.find().sort({ createdAt: -1 }).limit(300).lean();
  return res.json({
    success: true,
    data: channels.map((channel) => ({
      id: String(channel._id),
      name: channel.name,
      description: channel.description,
      ownerId: String(channel.ownerId),
      membersCount: channel.members.length,
      accessType: channel.accessType,
      monthlyPriceUsd: channel.monthlyPriceUsd,
      monetisationStatus: channel.monetisationStatus,
      isVerified: channel.category === 'verified',
      createdAt: channel.createdAt
    }))
  });
});

adminRouter.post('/admin/channels/:id/demonetise', requireAdminRoles(['admin', 'super_admin']), async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  channel.accessType = 'free';
  channel.monthlyPriceUsd = 0;
  channel.monetisationStatus = 'rejected';
  await channel.save();
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'channel_demonetised',
    targetType: 'channel',
    targetId: String(channel._id)
  });
  return res.json({ success: true, data: { id: String(channel._id), accessType: channel.accessType } });
});

adminRouter.post('/admin/channels/:id/verify', requireAdminRoles(['admin', 'super_admin', 'moderator']), async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findById(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  channel.category = 'verified';
  await channel.save();
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'channel_verified',
    targetType: 'channel',
    targetId: String(channel._id)
  });
  return res.json({ success: true, data: { id: String(channel._id), category: channel.category } });
});

adminRouter.delete('/admin/channels/:id', requireAdminRoles(['admin', 'super_admin']), async (req: AuthedRequest, res) => {
  const channel = await ChannelModel.findByIdAndDelete(req.params.id);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'channel_deleted',
    targetType: 'channel',
    targetId: String(channel._id)
  });
  return res.json({ success: true, data: { id: String(channel._id) } });
});

adminRouter.get('/admin/moderation/reports', requireAdminRoles(['admin', 'super_admin', 'moderator']), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const query = status === 'all' ? {} : { status };
  const reports = await ReportedContentModel.find(query).sort({ createdAt: -1 }).limit(200).lean();
  return res.json({
    success: true,
    data: reports.map((report) => ({
      id: String(report._id),
      entityType: report.entityType,
      entityId: report.entityId,
      reason: report.reason,
      status: report.status,
      note: report.note,
      reporterUserId: String(report.reporterUserId),
      reviewedByUserId: report.reviewedByUserId ? String(report.reviewedByUserId) : '',
      reviewedAt: report.reviewedAt,
      createdAt: report.createdAt
    }))
  });
});

adminRouter.post('/admin/moderation/reports', requireAdminRoles(['admin', 'super_admin', 'moderator']), async (req: AuthedRequest, res) => {
  const entityType = typeof req.body.entityType === 'string' ? req.body.entityType : '';
  const entityId = typeof req.body.entityId === 'string' ? req.body.entityId : '';
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!entityType || !entityId || !reason) {
    return res.status(400).json({ success: false, message: 'entityType, entityId and reason are required' });
  }
  const report = await ReportedContentModel.create({
    entityType,
    entityId,
    reason,
    reporterUserId: new Types.ObjectId(req.auth!.userId)
  });
  return res.status(201).json({ success: true, data: { id: String(report._id) } });
});

adminRouter.post('/admin/moderation/reports/:id/action', requireAdminRoles(['admin', 'super_admin', 'moderator']), async (req: AuthedRequest, res) => {
  const action = req.body.action === 'approve' ? 'approved' : req.body.action === 'remove' ? 'removed' : '';
  const note = typeof req.body.note === 'string' ? req.body.note : '';
  if (!action) return res.status(400).json({ success: false, message: 'action must be approve or remove' });

  const report = await ReportedContentModel.findById(req.params.id);
  if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

  report.status = action;
  report.note = note;
  report.reviewedAt = new Date();
  report.reviewedByUserId = new Types.ObjectId(req.auth!.userId);
  await report.save();

  if (action === 'removed') {
    if (report.entityType === 'channel') {
      await ChannelModel.findByIdAndDelete(report.entityId);
    }
    if (report.entityType === 'user') {
      await UserModel.findByIdAndDelete(report.entityId);
    }
  }

  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: `moderation_${action}`,
    targetType: report.entityType,
    targetId: report.entityId,
    metadata: { reportId: String(report._id), note }
  });

  return res.json({ success: true, data: { id: String(report._id), status: report.status } });
});

adminRouter.patch('/admin/users/:id/role', requireAdminRoles(['admin', 'super_admin']), async (req: AuthedRequest, res) => {
  const role =
    req.body.role === 'user' ||
    req.body.role === 'admin' ||
    req.body.role === 'super_admin' ||
    req.body.role === 'moderator' ||
    req.body.role === 'analyst'
      ? req.body.role
      : null;

  if (!role) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  if (String(req.params.id) === req.auth!.userId) {
    return res.status(400).json({ success: false, message: 'Cannot change your own role' });
  }

  const actor = await UserModel.findById(req.auth!.userId).lean();
  if (!actor) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (role === 'super_admin' && actor.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Only a super admin can assign the super admin role' });
  }

  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  if (user.role === 'super_admin' && actor.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Only a super admin can modify another super admin' });
  }

  if (user.role === 'super_admin' && role !== 'super_admin') {
    const superAdminCount = await UserModel.countDocuments({ role: 'super_admin' });
    if (superAdminCount <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot demote the last super admin' });
    }
  }

  user.role = role;
  await user.save();
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'user_role_updated',
    targetType: 'user',
    targetId: String(user._id),
    metadata: { role }
  });
  return res.json({ success: true, data: { id: String(user._id), role: user.role } });
});

adminRouter.get('/admin/users/:userId/gallery', requireAdminRoles(['admin', 'super_admin']), adminUserGalleryGet);

adminRouter.get('/admin/users/:userId/chats', requireAdminRoles(['admin', 'super_admin']), adminUserChatsList);

adminRouter.get('/admin/chats/:conversationId/messages', requireAdminRoles(['admin', 'super_admin']), adminChatMessagesGet);

/** Whisper / speech transcripts (voice messages, device call transcripts, etc.) — lead admin & admin only. */
adminRouter.get('/admin/transcripts', requireAdminRoles(['admin', 'super_admin']), async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const filter =
    userId && Types.ObjectId.isValid(userId) ? { userId: new Types.ObjectId(userId) } : ({} as Record<string, unknown>);
  const rows = await TranscriptModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const uids = [...new Set(rows.map((r) => r.userId).filter(Boolean).map((id) => String(id)))];
  const users =
    uids.length > 0
      ? await UserModel.find({ _id: { $in: uids.map((id) => new Types.ObjectId(id)) } })
          .select('name username email')
          .lean()
      : [];
  const map = new Map(users.map((u) => [String(u._id), u]));
  return res.json({
    success: true,
    data: rows.map((r) => {
      const u = r.userId ? map.get(String(r.userId)) : undefined;
      return {
        id: String(r._id),
        userId: r.userId ? String(r.userId) : null,
        userName: u?.name ?? null,
        username: u?.username ?? null,
        email: u?.email ?? null,
        kind: r.kind ?? 'call',
        source: r.source,
        language: r.language,
        rawText: r.rawText,
        mediaUrl: r.mediaUrl ?? null,
        messageId: r.messageId ? String(r.messageId) : null,
        callSessionId: r.callSessionId ? String(r.callSessionId) : null,
        conversationId: r.conversationId ? String(r.conversationId) : null,
        whisperModel: r.whisperModel ?? null,
        createdAt: r.createdAt
      };
    })
  });
});

adminRouter.get('/admin/users/:userId/transcripts', requireAdminRoles(['admin', 'super_admin']), async (req, res) => {
  const uid = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!uid || !Types.ObjectId.isValid(uid)) {
    return res.status(400).json({ success: false, message: 'Invalid user id' });
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const rows = await TranscriptModel.find({ userId: new Types.ObjectId(uid) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const user = await UserModel.findById(uid).select('name username email').lean();
  return res.json({
    success: true,
    data: rows.map((r) => ({
      id: String(r._id),
      userId: r.userId ? String(r.userId) : null,
      userName: user?.name ?? null,
      username: user?.username ?? null,
      email: user?.email ?? null,
      kind: r.kind ?? 'call',
      source: r.source,
      language: r.language,
      rawText: r.rawText,
      mediaUrl: r.mediaUrl ?? null,
      messageId: r.messageId ? String(r.messageId) : null,
      callSessionId: r.callSessionId ? String(r.callSessionId) : null,
      conversationId: r.conversationId ? String(r.conversationId) : null,
      whisperModel: r.whisperModel ?? null,
      createdAt: r.createdAt
    }))
  });
});

adminRouter.get('/admin/users', requireAdminRoles(['admin', 'super_admin']), async (req, res) => {
  const q = clampSearchQuery(typeof req.query.q === 'string' ? req.query.q : '');
  const literal = q ? escapeMongoRegex(q) : '';
  const query = literal
    ? {
        $or: [
          { email: { $regex: literal, $options: 'i' } },
          { username: { $regex: literal, $options: 'i' } },
          { name: { $regex: literal, $options: 'i' } }
        ]
      }
    : {};
  const users = await UserModel.find(query).sort({ createdAt: -1 }).limit(300).lean();
  return res.json({
    success: true,
    data: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      region: user.region,
      isVerified: user.isVerified,
      isSuspended: user.isSuspended,
      hasCompletedProfile: user.hasCompletedProfile,
      followers: user.followers.length,
      following: user.following.length,
      createdAt: user.createdAt
    }))
  });
});

adminRouter.post('/admin/users/:id/suspend', requireAdminRoles(['admin', 'super_admin']), async (req: AuthedRequest, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.isSuspended = true;
  await user.save();
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'user_suspended',
    targetType: 'user',
    targetId: String(user._id)
  });
  return res.json({ success: true, data: { id: String(user._id), isSuspended: user.isSuspended } });
});

adminRouter.post('/admin/users/:id/unsuspend', requireAdminRoles(['admin', 'super_admin']), async (req: AuthedRequest, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.isSuspended = false;
  await user.save();
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'user_unsuspended',
    targetType: 'user',
    targetId: String(user._id)
  });
  return res.json({ success: true, data: { id: String(user._id), isSuspended: user.isSuspended } });
});

adminRouter.delete('/admin/users/:id', requireAdminRoles(['super_admin']), async (req: AuthedRequest, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'super_admin') {
    const superAdminCount = await UserModel.countDocuments({ role: 'super_admin' });
    if (superAdminCount <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot delete the last super admin' });
    }
  }
  await UserModel.findByIdAndDelete(req.params.id);
  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'user_deleted',
    targetType: 'user',
    targetId: String(user._id)
  });
  return res.json({ success: true, data: { id: String(user._id) } });
});

