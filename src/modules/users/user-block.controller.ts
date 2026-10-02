import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import type { AuthedRequest } from '../../middleware/auth';
import { UserModel } from './user.model';
import { UserBlockModel } from './user-block.model';
import { getBlockedUserIds } from './user-block.service';
import { ReportedContentModel } from '../admin/reported-content.model';
import { sendModerationAlertEmail } from '../../lib/email';
import { AuditLogModel } from '../compliance/audit-log.model';

export async function blockUserController(req: AuthedRequest, res: Response) {
  const blockedId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const blockerId = req.auth!.userId;
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 500)
      : 'blocked_user';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';

  if (!Types.ObjectId.isValid(blockedId)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid user id' });
  }
  if (blockedId === blockerId) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'You cannot block yourself' });
  }

  const target = await UserModel.findById(blockedId).select('_id').lean();
  if (!target) {
    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'User not found' });
  }

  await UserBlockModel.updateOne(
    { blockerId: new Types.ObjectId(blockerId), blockedId: new Types.ObjectId(blockedId) },
    { $setOnInsert: { blockerId: new Types.ObjectId(blockerId), blockedId: new Types.ObjectId(blockedId) } },
    { upsert: true }
  );

  let reportId: string | null = null;
  const existingPending = await ReportedContentModel.findOne({
    entityType: 'user',
    entityId: blockedId,
    reporterUserId: new Types.ObjectId(blockerId),
    status: 'pending'
  }).lean();

  if (!existingPending) {
    const report = await ReportedContentModel.create({
      entityType: 'user',
      entityId: blockedId,
      reason,
      note: note || 'User blocked in app',
      reporterUserId: new Types.ObjectId(blockerId)
    });
    reportId = String(report._id);
    await AuditLogModel.create({
      actorUserId: blockerId,
      action: 'user_blocked_and_reported',
      targetType: 'user',
      targetId: blockedId,
      region: 'na',
      metadata: { reportId }
    });
    void sendModerationAlertEmail({
      reportId,
      entityType: 'user',
      entityId: blockedId,
      reason,
      reporterUserId: blockerId,
      note: note || 'User blocked in app'
    });
  }

  return res.status(StatusCodes.OK).json({
    success: true,
    data: { blockedId, reportId }
  });
}

export async function unblockUserController(req: AuthedRequest, res: Response) {
  const blockedId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!Types.ObjectId.isValid(blockedId)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid user id' });
  }
  await UserBlockModel.deleteOne({
    blockerId: new Types.ObjectId(req.auth!.userId),
    blockedId: new Types.ObjectId(blockedId)
  });
  return res.status(StatusCodes.OK).json({ success: true, data: { blockedId } });
}

export async function listBlockedUsersController(req: AuthedRequest, res: Response) {
  const ids = await getBlockedUserIds(req.auth!.userId);
  const users = ids.length
    ? await UserModel.find({ _id: { $in: ids } }).select('name username avatar').lean()
    : [];
  return res.status(StatusCodes.OK).json({
    success: true,
    data: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      username: u.username,
      avatar: u.avatar ?? ''
    }))
  });
}
