import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAdmin, requireAuth, type AuthedRequest } from '../../middleware/auth';
import { UserModel } from '../users/user.model';
import { ChannelModel } from '../channels/channel.model';
import { ConsentRecordModel } from './consent-record.model';
import { AuditLogModel } from './audit-log.model';
import { DsarRequestModel } from './dsar-request.model';
import { ErasureRequestModel } from './erasure-request.model';
import { ReportedContentModel } from '../admin/reported-content.model';

export const complianceRouter = Router();
const REPORTABLE_ENTITY_TYPES = new Set(['message', 'channel', 'user']);

async function writeAuditLog(input: {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  region?: 'eu' | 'apac' | 'na';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await AuditLogModel.create({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? '',
    region: input.region ?? 'na',
    metadata: input.metadata ?? {}
  });
}

complianceRouter.post('/compliance/consents', requireAuth, async (req: AuthedRequest, res) => {
  const purpose = typeof req.body.purpose === 'string' ? req.body.purpose.trim() : '';
  const policyVersion = typeof req.body.policyVersion === 'string' ? req.body.policyVersion.trim() : '';
  const ipAddress = typeof req.body.ipAddress === 'string' ? req.body.ipAddress.trim() : '';

  if (!purpose || !policyVersion) {
    return res.status(400).json({ success: false, message: 'purpose and policyVersion are required' });
  }

  const user = await UserModel.findById(req.auth!.userId).lean();
  const consent = await ConsentRecordModel.create({
    userId: req.auth!.userId,
    purpose,
    policyVersion,
    ipAddress
  });

  await writeAuditLog({
    actorUserId: req.auth!.userId,
    action: 'consent_recorded',
    targetType: 'consent_record',
    targetId: String(consent._id),
    region: user?.region ?? 'na',
    metadata: { purpose, policyVersion }
  });

  return res.status(201).json({ success: true, data: consent });
});

complianceRouter.post('/compliance/reports', requireAuth, async (req: AuthedRequest, res) => {
  const entityType = typeof req.body.entityType === 'string' ? req.body.entityType.trim().toLowerCase() : '';
  const entityId = typeof req.body.entityId === 'string' ? req.body.entityId.trim() : '';
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';

  if (!REPORTABLE_ENTITY_TYPES.has(entityType) || !entityId || !reason) {
    return res.status(400).json({
      success: false,
      message: 'entityType (message/channel/user), entityId, and reason are required'
    });
  }

  const user = await UserModel.findById(req.auth!.userId).lean();

  const existingPending = await ReportedContentModel.findOne({
    entityType,
    entityId,
    reporterUserId: new Types.ObjectId(req.auth!.userId),
    status: 'pending'
  }).lean();
  if (existingPending) {
    return res.status(409).json({ success: false, message: 'You already reported this item and it is pending review' });
  }

  const report = await ReportedContentModel.create({
    entityType,
    entityId,
    reason,
    note,
    reporterUserId: new Types.ObjectId(req.auth!.userId)
  });

  await writeAuditLog({
    actorUserId: req.auth!.userId,
    action: 'content_report_submitted',
    targetType: entityType,
    targetId: entityId,
    region: user?.region ?? 'na',
    metadata: { reportId: String(report._id), reason }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(report._id),
      status: report.status
    }
  });
});

complianceRouter.get('/compliance/reports', requireAuth, async (req: AuthedRequest, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const query: Record<string, unknown> = {
    reporterUserId: new Types.ObjectId(req.auth!.userId)
  };
  if (status && ['pending', 'approved', 'removed'].includes(status)) {
    query.status = status;
  }

  const reports = await ReportedContentModel.find(query).sort({ createdAt: -1 }).limit(100).lean();
  return res.json({
    success: true,
    data: reports.map((report) => ({
      id: String(report._id),
      entityType: report.entityType,
      entityId: report.entityId,
      reason: report.reason,
      note: report.note ?? '',
      status: report.status,
      reviewedAt: report.reviewedAt ?? null,
      createdAt: report.createdAt
    }))
  });
});

complianceRouter.post('/compliance/dsar', requireAuth, async (req: AuthedRequest, res) => {
  const user = await UserModel.findById(req.auth!.userId).lean();
  const request = await DsarRequestModel.create({
    userId: req.auth!.userId,
    status: 'processing',
    encryptedArchiveName: `connectify-dsar-${req.auth!.userId}-${Date.now()}.zip.enc`,
    exportUrl: `mock://exports/${req.auth!.userId}/${Date.now()}`,
    requestedAt: new Date(),
    completedAt: new Date()
  });

  await writeAuditLog({
    actorUserId: req.auth!.userId,
    action: 'dsar_requested',
    targetType: 'dsar_request',
    targetId: String(request._id),
    region: user?.region ?? 'na'
  });

  request.status = 'completed';
  await request.save();

  return res.status(201).json({
    success: true,
    data: {
      id: String(request._id),
      status: request.status,
      exportUrl: request.exportUrl,
      encryptedArchiveName: request.encryptedArchiveName
    }
  });
});

complianceRouter.post('/compliance/erasure', requireAuth, async (req: AuthedRequest, res) => {
  const legalHoldReason = typeof req.body.legalHoldReason === 'string' ? req.body.legalHoldReason.trim() : '';
  const user = await UserModel.findById(req.auth!.userId).lean();
  const request = await ErasureRequestModel.create({
    userId: req.auth!.userId,
    status: legalHoldReason ? 'processing' : 'completed',
    legalHoldReason,
    requestedAt: new Date(),
    completedAt: legalHoldReason ? undefined : new Date()
  });

  await writeAuditLog({
    actorUserId: req.auth!.userId,
    action: 'erasure_requested',
    targetType: 'erasure_request',
    targetId: String(request._id),
    region: user?.region ?? 'na',
    metadata: { legalHoldReason }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: String(request._id),
      status: request.status,
      legalHoldReason: request.legalHoldReason
    }
  });
});

complianceRouter.get('/compliance/requests', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;
  const [dsarRequests, erasureRequests] = await Promise.all([
    DsarRequestModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
    ErasureRequestModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  return res.json({
    success: true,
    data: {
      dsarRequests: dsarRequests.map((item) => ({
        id: String(item._id),
        userId: String(item.userId),
        status: item.status,
        requestedAt: item.requestedAt,
        completedAt: item.completedAt,
        exportUrl: item.exportUrl,
        encryptedArchiveName: item.encryptedArchiveName
      })),
      erasureRequests: erasureRequests.map((item) => ({
        id: String(item._id),
        userId: String(item.userId),
        status: item.status,
        legalHoldReason: item.legalHoldReason,
        requestedAt: item.requestedAt,
        completedAt: item.completedAt
      }))
    }
  });
});

complianceRouter.patch('/compliance/users/:id/region', requireAdmin, async (req, res) => {
  const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const region = req.body.region === 'eu' || req.body.region === 'apac' || req.body.region === 'na' ? req.body.region : null;
  if (!region) {
    return res.status(400).json({ success: false, message: 'region must be eu, apac, or na' });
  }

  const user = await UserModel.findById(targetUserId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  user.region = region;
  await user.save();

  await writeAuditLog({
    actorUserId: targetUserId,
    action: 'user_region_updated',
    targetType: 'user',
    targetId: String(user._id),
    region,
    metadata: { region }
  });

  return res.json({ success: true, data: { id: String(user._id), region: user.region } });
});

complianceRouter.get('/admin/compliance/requests', requireAdmin, async (_req, res) => {
  const [dsarRequests, erasureRequests] = await Promise.all([
    DsarRequestModel.find().sort({ createdAt: -1 }).limit(100).lean(),
    ErasureRequestModel.find().sort({ createdAt: -1 }).limit(100).lean()
  ]);

  return res.json({
    success: true,
    data: {
      dsarRequests: dsarRequests.map((item) => ({
        id: String(item._id),
        userId: String(item.userId),
        status: item.status,
        requestedAt: item.requestedAt,
        completedAt: item.completedAt
      })),
      erasureRequests: erasureRequests.map((item) => ({
        id: String(item._id),
        userId: String(item.userId),
        status: item.status,
        legalHoldReason: item.legalHoldReason,
        requestedAt: item.requestedAt,
        completedAt: item.completedAt
      }))
    }
  });
});

complianceRouter.get('/admin/compliance/audit-logs', requireAdmin, async (req, res) => {
  const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const query = action ? { action } : {};
  const logs = await AuditLogModel.find(query).sort({ createdAt: -1 }).limit(200).lean();

  return res.json({
    success: true,
    data: logs.map((log) => ({
      id: String(log._id),
      actorUserId: log.actorUserId ? String(log.actorUserId) : '',
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      region: log.region,
      metadata: log.metadata,
      createdAt: log.createdAt
    }))
  });
});

complianceRouter.get('/admin/compliance/article-30-report', requireAdmin, async (_req, res) => {
  const [users, channels, consents] = await Promise.all([
    UserModel.countDocuments(),
    ChannelModel.countDocuments(),
    ConsentRecordModel.countDocuments()
  ]);

  const rows = [
    ['processing_activity', 'record_count'],
    ['user_profiles', String(users)],
    ['channels', String(channels)],
    ['consent_records', String(consents)]
  ];

  res.setHeader('Content-Type', 'text/csv');
  return res.send(rows.map((row) => row.join(',')).join('\n'));
});

