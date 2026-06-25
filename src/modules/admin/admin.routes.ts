import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
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
import { canAdminAccessUser, requireAdminCapability } from './access';

export const adminRouter = Router();

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: 'admin';
  adminScope: 'global' | 'assigned';
  createdAt: Date;
  assignedUsersCount: number;
  createdBySuperAdminId?: string;
};

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

async function listAdminUsers(): Promise<AdminUserRow[]> {
  const admins = await UserModel.find({ role: 'admin' })
    .sort({ createdAt: -1 })
    .select('name email username role adminScope createdAt createdBySuperAdminId')
    .lean();

  const counts = await UserModel.aggregate([
    { $match: { role: 'user', assignedAdminId: { $type: 'objectId' } } },
    { $group: { _id: '$assignedAdminId', value: { $sum: 1 } } }
  ]);
  const countByAdminId = new Map(counts.map((row) => [String(row._id), Number(row.value ?? 0)]));

  return admins.map((admin) => ({
    id: String(admin._id),
    name: admin.name,
    email: admin.email,
    username: admin.username,
    role: 'admin',
    adminScope: admin.adminScope === 'assigned' ? 'assigned' : 'global',
    createdAt: admin.createdAt,
    assignedUsersCount: countByAdminId.get(String(admin._id)) ?? 0,
    createdBySuperAdminId: admin.createdBySuperAdminId ? String(admin.createdBySuperAdminId) : undefined
  }));
}

adminRouter.get('/admin/analytics/overview', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'analytics');
  if (!actor) return;

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

adminRouter.get('/admin/activities', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'user_management');
  if (!actor) return;
  if (actor.role !== 'super_admin' && actor.adminScope !== 'global') {
    return res.status(403).json({ success: false, message: 'This admin account is limited to assigned users only' });
  }

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

adminRouter.get('/admin/channels', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'channels');
  if (!actor) return;

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

adminRouter.post('/admin/channels/:id/demonetise', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'channels');
  if (!actor) return;
  if (actor.role !== 'super_admin' && actor.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admins can stop paid earnings' });
  }

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

adminRouter.post('/admin/channels/:id/verify', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'channels');
  if (!actor) return;

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

adminRouter.delete('/admin/channels/:id', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'channels');
  if (!actor) return;
  if (actor.role !== 'super_admin' && actor.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admins can remove a channel' });
  }

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

adminRouter.get('/admin/moderation/reports', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'moderation');
  if (!actor) return;

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

adminRouter.post('/admin/moderation/reports', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'moderation');
  if (!actor) return;

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

adminRouter.post('/admin/moderation/reports/:id/action', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'moderation');
  if (!actor) return;

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

adminRouter.get('/admin/admin-users', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;
  return res.json({ success: true, data: await listAdminUsers() });
});

adminRouter.post('/admin/admin-users', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const usernameRaw = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const username = usernameRaw || email.split('@')[0] || '';

  if (name.length < 2) {
    return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Valid email is required' });
  }
  if (!/^[a-z0-9_.]{3,24}$/i.test(username)) {
    return res.status(400).json({ success: false, message: 'Username must be 3-24 letters, numbers, underscores, or dots' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }

  const existing = await UserModel.findOne({ $or: [{ email }, { username }] }).select('_id').lean();
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email or username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await UserModel.create({
    name,
    email,
    username,
    passwordHash,
    role: 'admin',
    adminScope: 'assigned',
    isVerified: true,
    hasCompletedProfile: true,
    createdBySuperAdminId: new Types.ObjectId(req.auth!.userId)
  });

  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'admin_created',
    targetType: 'user',
    targetId: String(user._id),
    metadata: { adminScope: 'assigned' }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      adminScope: user.adminScope
    }
  });
});

adminRouter.post('/admin/admin-users/:adminId/assign-users', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;

  const adminId = Array.isArray(req.params.adminId) ? req.params.adminId[0] : req.params.adminId;
  if (!adminId || !Types.ObjectId.isValid(adminId)) {
    return res.status(400).json({ success: false, message: 'Valid admin id is required' });
  }
  const targetAdmin = await UserModel.findById(adminId).select('role adminScope').lean();
  if (!targetAdmin || targetAdmin.role !== 'admin' || targetAdmin.adminScope !== 'assigned') {
    return res.status(404).json({ success: false, message: 'Admin not found' });
  }

  const rawUserIds: unknown[] = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  const userIds = [...new Set(rawUserIds.map((value: unknown) => String(value)).filter((id: string) => Types.ObjectId.isValid(id)))];
  const assignmentNote = typeof req.body.assignmentNote === 'string' ? req.body.assignmentNote.trim().slice(0, 500) : '';
  if (!userIds.length) {
    return res.status(400).json({ success: false, message: 'At least one valid user id is required' });
  }

  const now = new Date();
  const result = await UserModel.updateMany(
    {
      _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      role: 'user'
    },
    {
      $set: {
        assignedAdminId: new Types.ObjectId(adminId),
        assignedBySuperAdminId: new Types.ObjectId(req.auth!.userId),
        assignedAt: now,
        assignmentNote
      }
    }
  );

  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'users_assigned_to_admin',
    targetType: 'user_assignment',
    targetId: adminId,
    metadata: { userIds, assignmentNote }
  });

  return res.json({ success: true, data: { adminId, matched: result.matchedCount, updated: result.modifiedCount } });
});

adminRouter.post('/admin/admin-users/:adminId/unassign-users', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;

  const adminId = Array.isArray(req.params.adminId) ? req.params.adminId[0] : req.params.adminId;
  if (!adminId || !Types.ObjectId.isValid(adminId)) {
    return res.status(400).json({ success: false, message: 'Valid admin id is required' });
  }

  const rawUserIds: unknown[] = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  const userIds = [...new Set(rawUserIds.map((value: unknown) => String(value)).filter((id: string) => Types.ObjectId.isValid(id)))];
  if (!userIds.length) {
    return res.status(400).json({ success: false, message: 'At least one valid user id is required' });
  }

  const result = await UserModel.updateMany(
    {
      _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      role: 'user',
      assignedAdminId: new Types.ObjectId(adminId)
    },
    {
      $unset: {
        assignedAdminId: '',
        assignedBySuperAdminId: '',
        assignedAt: '',
        assignmentNote: ''
      }
    }
  );

  await logAdminAction({
    actorUserId: req.auth!.userId,
    action: 'users_unassigned_from_admin',
    targetType: 'user_assignment',
    targetId: adminId,
    metadata: { userIds }
  });

  return res.json({ success: true, data: { adminId, matched: result.matchedCount, updated: result.modifiedCount } });
});

adminRouter.patch('/admin/users/:id/role', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;

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

  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  if (user.role === 'super_admin' && role !== 'super_admin') {
    const superAdminCount = await UserModel.countDocuments({ role: 'super_admin' });
    if (superAdminCount <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot demote the last super admin' });
    }
  }

  user.role = role;
  user.adminScope = role === 'admin' ? 'assigned' : 'global';
  user.createdBySuperAdminId = role === 'admin' ? new Types.ObjectId(req.auth!.userId) : undefined;
  if (role !== 'user') {
    user.assignedAdminId = undefined;
    user.assignedBySuperAdminId = undefined;
    user.assignedAt = undefined;
    user.assignmentNote = '';
  }
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

adminRouter.get('/admin/users/:userId/gallery', requireAuth, adminUserGalleryGet);

adminRouter.get('/admin/users/:userId/chats', requireAuth, adminUserChatsList);

adminRouter.get('/admin/chats/:conversationId/messages', requireAuth, adminChatMessagesGet);

/** Whisper / speech transcripts (voice messages, device call transcripts, etc.) — lead admin & admin only. */
adminRouter.get('/admin/transcripts', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'transcripts');
  if (!actor) return;

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

adminRouter.get('/admin/users/:userId/transcripts', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'transcripts');
  if (!actor) return;

  const uid = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!uid || !Types.ObjectId.isValid(uid)) {
    return res.status(400).json({ success: false, message: 'Invalid user id' });
  }
  if (!(await canAdminAccessUser(actor, uid))) {
    return res.status(403).json({ success: false, message: 'You cannot access this user' });
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

adminRouter.get('/admin/users', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'user_management');
  if (!actor) return;

  const q = clampSearchQuery(typeof req.query.q === 'string' ? req.query.q : '');
  const literal = q ? escapeMongoRegex(q) : '';
  const baseQuery = actor.role === 'super_admin' || actor.adminScope === 'global'
    ? { role: 'user' }
    : { role: 'user', assignedAdminId: actor._id };
  const query = literal
    ? {
        ...baseQuery,
        $or: [
          { email: { $regex: literal, $options: 'i' } },
          { username: { $regex: literal, $options: 'i' } },
          { name: { $regex: literal, $options: 'i' } }
        ]
      }
    : baseQuery;
  const users = await UserModel.find(query)
    .sort({ createdAt: -1 })
    .limit(300)
    .populate('assignedAdminId', 'name email')
    .lean();
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
      assignedAdminId:
        user.assignedAdminId && typeof user.assignedAdminId === 'object' && '_id' in (user.assignedAdminId as object)
          ? String((user.assignedAdminId as any)._id)
          : user.assignedAdminId
            ? String(user.assignedAdminId)
            : null,
      assignedAdminName:
        user.assignedAdminId && typeof user.assignedAdminId === 'object' && '_id' in (user.assignedAdminId as object)
          ? ((user.assignedAdminId as any).name ?? '')
          : '',
      assignmentNote: user.assignmentNote ?? '',
      createdAt: user.createdAt
    }))
  });
});

adminRouter.post('/admin/users/:id/suspend', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'user_management');
  if (!actor) return;
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId || !(await canAdminAccessUser(actor, userId))) {
    return res.status(403).json({ success: false, message: 'You cannot manage this user' });
  }
  const user = await UserModel.findById(userId);
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

adminRouter.post('/admin/users/:id/unsuspend', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'user_management');
  if (!actor) return;
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId || !(await canAdminAccessUser(actor, userId))) {
    return res.status(403).json({ success: false, message: 'You cannot manage this user' });
  }
  const user = await UserModel.findById(userId);
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

adminRouter.delete('/admin/users/:id', requireAuth, async (req: AuthedRequest, res) => {
  const actor = await requireAdminCapability(req, res, 'admin_management');
  if (!actor) return;
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
